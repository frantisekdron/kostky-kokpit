/*
 * view-plan.js — sekce "Plán stavby" (KONTRAKT.md §9.3) kokpitu Pragerovy kostky.
 *
 * Vykresluje svislou časovou osu milníků stavby seskupenou po letech (2026-2029),
 * s vodorovnou linkou "dnes" na správném místě, s připnutými našimi návštěvami
 * (podle navsteva.milnik_id, klik skočí na #navstevy) a s komentáři u každého
 * milníku. Pro právo `plan.upravit` umožňuje přidání, editaci (název, popis,
 * datum_od/datum_do, presnost, stav, poznámka, zdroj) a soft-delete milníku přímo
 * v modálu. Pro právo `komentare.pridat` umožňuje psát komentáře k milníku
 * (zapisují se přímo do aktivita.json, entita:"milnik"). Nahoře je souhrn:
 * kolik milníků je hotovo z celku + nejbližší milník.
 *
 * Sekce je dvousloupcová ("fifty fifty"): VLEVO naše časová osa, VPRAVO panel
 * s CELÝM původním harmonogramem od PORR tak, jak přišel — doslovný obsah bere
 * z globálu App.obsah("harmonogram") (js/harmonogram.js, načtený před tímto souborem).
 * Panel je vizuálně odlišený jako citace (modrá levá linka), jde sbalit (stav
 * jen v paměti) a řádek dokumentu, který se shoduje s naším milníkem (podle
 * pole zdroj_text), je klikatelný — skočí na ten milník vlevo a krátce ho
 * zvýrazní. Pod 900 px jsou sloupce pod sebou (nejdřív náš plán, pak dokument).
 * Když App.obsah("harmonogram") chybí, sekce se vykreslí jako dřív, jen jednosloupcově.
 *
 * Používá skutečné App.* API z js/app.js (App.polozky(soubor) pro čtení pole
 * položek, App.uloz(soubor, obsah) pro zápis celé obálky po GH.zmen — App.data
 * drží VŽDY celou obálku, nikdy se nesahá na App.data[soubor] přímo, viz
 * hlavičkový komentář js/app.js — dále App.modal({nadpis,obsah,akce}),
 * App.potvrd, App.toast, App.prekresli) a
 * CSS třídy již definované v styles.css (.casova-osa/.osa-rok/.osa-polozka/
 * .osa-uzel/.osa-dnesek/.osa-navsteva, .karta-nadpis/.karta-meta/.karta-popis/
 * .karta-akce, .nadpis-sekce/.podnadpis-sekce/.oddil, .pole/.pole-radek,
 * .prazdny-stav, .btn-primarni/.btn-sekundarni/.btn-nebezpecny/.btn-mala,
 * .stitek stav-<hodnota>) — přesný seznam viz POZNAMKY_D-plan-materialy.md.
 *
 * Nevystavuje žádný globální objekt — jen se při načtení zaregistruje jako sekce
 * 'plan' přes App.registrujSekci('plan', vykresli). Čte App.polozky
 * ("plan"/"navstevy"/"aktivita"), zapisuje přes GH.zmen('plan', ...) a
 * GH.zmen('aktivita', ...).
 */

(function () {
  "use strict";

  var esc = Util.esc;
  var SOUBOR = "plan";

  var STAV_MILNIKU = {
    hotovo: "Hotovo",
    probiha: "Probíhá",
    planovano: "Plánováno",
    posunuto: "Posunuto"
  };

  var STAV_NAVSTEVY = {
    navrh: "Návrh",
    "ke-schvaleni": "Ke schválení",
    schvaleno: "Schváleno",
    potvrzeno: "Potvrzeno",
    probehlo: "Proběhlo",
    zruseno: "Zrušeno"
  };

  var TYP_NAVSTEVY = {
    foto: "foto",
    dron: "dron",
    rucni: "ruční",
    "casosber-servis": "časosběr servis",
    rozhovor: "rozhovor"
  };

  // otevrene komentare (mnozina entita_id) prezije mezi prekresleni (napr. po
  // pollingu), at se uzivateli nezavira rozbaleny panel pod rukama
  var otevreneKomentare = {};

  // Panel s původním harmonogramem: sbalení si pamatujeme jen v paměti (po
  // obnovení stránky je zase rozbalený — kontrakt nechce další localStorage).
  var panelZdrojeOtevreny = true;

  // Mapa id milníku -> jeho uzel v ose. Plní se při každém vykreslení, slouží
  // k proklikům z pravého sloupce (dokument) na levý (naše osa).
  var uzlyMilniku = {};

  // Doběh krátkého zvýraznění po prokliku (ať se dvě kliknutí nepraly).
  var casovacZvyrazneni = null;
  var zvyraznenyUzel = null;

  // ---------------------------------------------------------------------
  // Cteni App.data — App.data[soubor] drzi VZDY celou obalku {verze,...,
  // polozky} (viz js/app.js). Tenky obal nad spolecnym App.polozky().
  // ---------------------------------------------------------------------

  // Datum milníku vypisujeme PŘESNĚ TAK, JAK HO NAPSALI ONI (pole datum_slovy —
  // „konec 09/2026", „cca polovina 10/2026", „03/2029–04/2029"). Franta na tom
  // trvá: jejich harmonogram je pro obě strany závazný podklad a naše
  // normalizace na „říjen 2026" mění význam. ISO datum (datum_od/datum_do)
  // slouží už jen k řazení a k umístění na časové ose.
  function datumMilniku(m) {
    if (m && m.datum_slovy) return m.datum_slovy;
    return Util.formatDatum(m.datum_od, m.presnost, m.datum_do);
  }

  function ziskejPolozky(soubor) {
    return App.polozky(soubor);
  }

  function najdiPodleId(pole, id) {
    for (var i = 0; i < pole.length; i++) {
      if (pole[i].id === id) return pole[i];
    }
    return null;
  }

  function dnesIso() {
    var d = new Date();
    var mm = d.getMonth() + 1;
    var dd = d.getDate();
    return d.getFullYear() + "-" + (mm < 10 ? "0" + mm : "" + mm) + "-" + (dd < 10 ? "0" + dd : "" + dd);
  }

  function potvrdBezpecne(text) {
    if (window.App && typeof App.potvrd === "function") return Promise.resolve(App.potvrd(text));
    return Promise.resolve(window.confirm(text));
  }

  // ---------------------------------------------------------------------
  // Stavebnice HTML formularovych poli (escapovane hodnoty)
  // ---------------------------------------------------------------------

  function poleHtml(jmeno, label, typ, hodnota, povinne) {
    var id = "pole-plan-" + jmeno;
    return (
      '<div class="pole">' +
      '<label for="' + id + '">' + esc(label) + (povinne ? " *" : "") + "</label>" +
      '<input type="' + typ + '" id="' + id + '" name="' + jmeno + '" value="' + esc(hodnota || "") + '">' +
      "</div>"
    );
  }

  function poleTextareaHtml(jmeno, label, hodnota) {
    var id = "pole-plan-" + jmeno;
    return (
      '<div class="pole">' +
      '<label for="' + id + '">' + esc(label) + "</label>" +
      '<textarea id="' + id + '" name="' + jmeno + '" rows="3">' + esc(hodnota || "") + "</textarea></div>"
    );
  }

  function poleSelectHtml(jmeno, label, moznosti, vybrana) {
    var id = "pole-plan-" + jmeno;
    var opts = moznosti
      .map(function (m) {
        var sel = m[0] === vybrana ? " selected" : "";
        return '<option value="' + esc(m[0]) + '"' + sel + ">" + esc(m[1]) + "</option>";
      })
      .join("");
    return (
      '<div class="pole">' +
      '<label for="' + id + '">' + esc(label) + "</label>" +
      '<select id="' + id + '" name="' + jmeno + '">' + opts + "</select></div>"
    );
  }

  // ---------------------------------------------------------------------
  // Komentare k milniku (aktivita.json, entita:"milnik")
  // ---------------------------------------------------------------------

  function vytvorKomentare(entitaId) {
    var vsechny = ziskejPolozky("aktivita");
    var komentare = vsechny
      .filter(function (a) {
        return a.entita === "milnik" && a.entita_id === entitaId && a.druh === "komentar" && !a.smazano;
      })
      .sort(function (a, b) {
        return a.kdy < b.kdy ? -1 : a.kdy > b.kdy ? 1 : 0;
      });

    var detail = document.createElement("details");
    detail.className = "komentare";
    detail.open = !!otevreneKomentare[entitaId];
    detail.addEventListener("toggle", function () {
      if (detail.open) {
        otevreneKomentare[entitaId] = true;
      } else {
        delete otevreneKomentare[entitaId];
      }
    });

    var shrnuti = document.createElement("summary");
    shrnuti.textContent = "Komentáře (" + komentare.length + ")";
    detail.appendChild(shrnuti);

    var seznam = document.createElement("div");
    seznam.className = "komentare-seznam";
    if (!komentare.length) {
      var prazdno = document.createElement("p");
      prazdno.className = "karta-meta";
      prazdno.textContent = "Zatím žádné komentáře.";
      seznam.appendChild(prazdno);
    } else {
      komentare.forEach(function (k) {
        seznam.appendChild(vytvorKomentar(k));
      });
    }
    detail.appendChild(seznam);

    if (Auth.can("komentare.pridat")) {
      detail.appendChild(vytvorFormularKomentare(entitaId));
    }

    return detail;
  }

  function vytvorKomentar(k) {
    var wrap = document.createElement("div");
    wrap.className = "komentar";

    var hlavicka = document.createElement("p");
    hlavicka.className = "karta-meta";
    var autor = document.createElement("strong");
    autor.textContent = k.kdo;
    hlavicka.appendChild(autor);
    hlavicka.appendChild(document.createTextNode(" · " + Util.formatCas(k.kdy)));
    wrap.appendChild(hlavicka);

    var text = document.createElement("p");
    text.className = "karta-popis";
    text.textContent = k.text;
    wrap.appendChild(text);

    var muzeSmazat = Auth.can("komentare.smazat.cizi") || (Auth.ja && Auth.ja.id === k.kdo);
    if (muzeSmazat) {
      var smazat = document.createElement("button");
      smazat.type = "button";
      smazat.className = "btn btn-mala btn-sekundarni";
      smazat.textContent = "Smazat komentář";
      smazat.addEventListener("click", function () {
        smazatKomentar(k);
      });
      wrap.appendChild(smazat);
    }

    return wrap;
  }

  function smazatKomentar(komentar) {
    potvrdBezpecne("Smazat tento komentář?").then(function (ano) {
      if (!ano) return;
      GH.zmen("aktivita", function (polozky) {
        var p = najdiPodleId(polozky, komentar.id);
        if (p) p.smazano = { kdy: new Date().toISOString(), kdo: (Auth.ja && Auth.ja.osoba_id) || null };
      })
        .then(function (vysledek) {
          App.uloz("aktivita", vysledek);
          App.toast("Komentář smazán.", "ok");
          App.prekresli();
        })
        .catch(function (chyba) {
          App.toast((chyba && chyba.hlaska) || "Smazání komentáře selhalo.", "chyba");
        });
    });
  }

  function vytvorFormularKomentare(entitaId) {
    var form = document.createElement("form");
    form.className = "komentar-formular";

    var pole = document.createElement("div");
    pole.className = "pole";
    var textarea = document.createElement("textarea");
    textarea.rows = 2;
    textarea.name = "text";
    textarea.placeholder = "Napsat komentář k milníku…";
    pole.appendChild(textarea);
    form.appendChild(pole);

    var tlacitko = document.createElement("button");
    tlacitko.type = "submit";
    tlacitko.className = "btn btn-mala btn-primarni";
    tlacitko.textContent = "Přidat komentář";
    form.appendChild(tlacitko);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = textarea.value.trim();
      if (!text) return;
      tlacitko.disabled = true;
      GH.zmen("aktivita", function (polozky) {
        polozky.push({
          id: GH.noveId("akt"),
          entita: "milnik",
          entita_id: entitaId,
          druh: "komentar",
          text: text,
          kdo: Auth.ja.id,
          kdy: new Date().toISOString(),
          smazano: null
        });
      })
        .then(function (vysledek) {
          App.uloz("aktivita", vysledek);
          otevreneKomentare[entitaId] = true;
          App.toast("Komentář přidán.", "ok");
          App.prekresli();
        })
        .catch(function (chyba) {
          App.toast((chyba && chyba.hlaska) || "Přidání komentáře selhalo.", "chyba");
          tlacitko.disabled = false;
        });
    });

    return form;
  }

  // ---------------------------------------------------------------------
  // Editace / pridani / soft-delete milniku
  // ---------------------------------------------------------------------

  function otevriFormularMilniku(milnik) {
    var jeNovy = !milnik;
    var form = document.createElement("form");
    form.innerHTML =
      poleHtml("nazev", "Název", "text", milnik ? milnik.nazev : "", true) +
      poleTextareaHtml("popis", "Popis", milnik ? milnik.popis : "") +
      '<div class="pole-radek">' +
      poleHtml("datum_od", "Datum od", "date", milnik ? milnik.datum_od : "", true) +
      poleHtml("datum_do", "Datum do", "date", milnik ? milnik.datum_do : "") +
      "</div>" +
      poleSelectHtml(
        "presnost",
        "Přesnost",
        [
          ["presne", "Přesně"],
          ["mesic", "Měsíc"],
          ["obdobi", "Období"]
        ],
        milnik ? milnik.presnost : "presne"
      ) +
      poleSelectHtml(
        "stav",
        "Stav",
        [
          ["hotovo", "Hotovo"],
          ["probiha", "Probíhá"],
          ["planovano", "Plánováno"],
          ["posunuto", "Posunuto"]
        ],
        milnik ? milnik.stav : "planovano"
      ) +
      poleHtml("zdroj", "Zdroj", "text", milnik ? milnik.zdroj : "") +
      poleTextareaHtml("poznamka", "Poznámka", milnik ? milnik.poznamka : "");

    var handle;

    function pokusUlozit() {
      var data = nacistFormularMilniku(form);
      if (!data) return;
      ulozitMilnik(jeNovy, milnik, data).then(function (ok) {
        if (ok) handle.zavri();
      });
    }

    var akce = [{ text: "Zrušit", druh: "sekundarni", fn: function () { handle.zavri(); } }];
    if (!jeNovy) {
      akce.push({
        text: "Smazat (do koše)",
        druh: "nebezpecny",
        fn: function () {
          handle.zavri();
          smazatMilnik(milnik);
        }
      });
    }
    akce.push({ text: jeNovy ? "Přidat milník" : "Uložit", druh: "primarni", fn: pokusUlozit });

    handle = App.modal({
      nadpis: jeNovy ? "Nový milník" : "Upravit milník: " + milnik.nazev,
      obsah: form,
      akce: akce
    });
  }

  function nacistFormularMilniku(form) {
    var nazev = form.elements["nazev"].value.trim();
    var datumOd = form.elements["datum_od"].value;
    if (!nazev) {
      App.toast("Vyplň název milníku.", "chyba");
      return null;
    }
    if (!datumOd) {
      App.toast("Vyplň datum od.", "chyba");
      return null;
    }
    var datumDo = form.elements["datum_do"].value || datumOd;
    return {
      nazev: nazev,
      popis: form.elements["popis"].value.trim(),
      datum_od: datumOd,
      datum_do: datumDo,
      presnost: form.elements["presnost"].value,
      stav: form.elements["stav"].value,
      zdroj: form.elements["zdroj"].value.trim(),
      // datum_slovy (znění termínu od PORR) formulář needituje — Object.assign
      // níž by ho nechalo být, ale u NOVÉHO milníku ho odvodíme z data, ať
      // karta nezůstane bez termínu.
      poznamka: form.elements["poznamka"].value.trim()
    };
  }

  function ulozitMilnik(jeNovy, milnik, data) {
    var rok = parseInt(data.datum_od.slice(0, 4), 10);
    // U nového milníku odvodíme znění termínu z data — u těch z harmonogramu
    // PORR zůstává jejich vlastní (datum_slovy formulář needituje, takže ho
    // Object.assign níž nepřepíše).
    if (jeNovy) {
      data.datum_slovy = Util.formatDatum(data.datum_od, data.presnost, data.datum_do);
    }
    return GH.zmen(
      SOUBOR,
      function (polozky) {
        if (jeNovy) {
          var maxPoradi = polozky.reduce(function (m, p) {
            return Math.max(m, p.poradi || 0);
          }, 0);
          polozky.push(
            Object.assign({}, data, {
              id: GH.noveId("mil"),
              poradi: maxPoradi + 1,
              rok: rok,
              smazano: null
            })
          );
        } else {
          var p = najdiPodleId(polozky, milnik.id);
          if (!p) throw new Error("Milník nenalezen.");
          Object.assign(p, data, { rok: rok });
        }
      },
      (jeNovy ? 'Přidán milník "' : 'Upraven milník "') + data.nazev + '".'
    )
      .then(function (vysledek) {
        App.uloz("plan", vysledek);
        App.toast(jeNovy ? "Milník přidán." : "Milník upraven.", "ok");
        App.prekresli();
        return true;
      })
      .catch(function (chyba) {
        App.toast((chyba && chyba.hlaska) || "Uložení milníku selhalo.", "chyba");
        return false;
      });
  }

  function smazatMilnik(milnik) {
    potvrdBezpecne('Poslat milník "' + milnik.nazev + '" do koše?').then(function (ano) {
      if (!ano) return;
      GH.zmen(
        SOUBOR,
        function (polozky) {
          var p = najdiPodleId(polozky, milnik.id);
          if (p) p.smazano = { kdy: new Date().toISOString(), kdo: (Auth.ja && Auth.ja.osoba_id) || null };
        },
        'Smazán milník "' + milnik.nazev + '".'
      )
        .then(function (vysledek) {
          App.uloz("plan", vysledek);
          App.toast("Milník poslán do koše.", "ok");
          App.prekresli();
        })
        .catch(function (chyba) {
          App.toast((chyba && chyba.hlaska) || "Smazání milníku selhalo.", "chyba");
        });
    });
  }

  // ---------------------------------------------------------------------
  // Vykresleni
  // ---------------------------------------------------------------------

  function vytvorHlavicku(milniky) {
    var oddil = document.createElement("section");
    oddil.className = "oddil";

    var h2 = document.createElement("h2");
    h2.className = "nadpis-sekce";
    h2.textContent = "Plán stavby";
    oddil.appendChild(h2);

    var hotovo = milniky.filter(function (m) {
      return m.stav === "hotovo";
    }).length;

    var razene = milniky.slice().sort(function (a, b) {
      return a.datum_od < b.datum_od ? -1 : a.datum_od > b.datum_od ? 1 : 0;
    });
    var nejblizsi = null;
    for (var i = 0; i < razene.length; i++) {
      if (razene[i].stav !== "hotovo") {
        nejblizsi = razene[i];
        break;
      }
    }

    var souhrn = document.createElement("p");
    souhrn.className = "podnadpis-sekce";
    var textSouhrn = hotovo + " / " + milniky.length + " milníků hotovo";
    if (nejblizsi) {
      var dni = Util.zaDni(nejblizsi.datum_od);
      textSouhrn +=
        " · Nejbližší: " +
        nejblizsi.nazev +
        " — " +
        datumMilniku(nejblizsi) +
        " (" +
        Util.formatOdpocet(dni) +
        ")";
    } else if (milniky.length) {
      textSouhrn += " · Všechny milníky jsou hotové.";
    }
    souhrn.textContent = textSouhrn;
    oddil.appendChild(souhrn);

    if (Auth.can("plan.upravit")) {
      var pridat = document.createElement("button");
      pridat.type = "button";
      pridat.className = "btn btn-primarni";
      pridat.style.marginTop = "10px";
      pridat.textContent = "+ Přidat milník";
      pridat.addEventListener("click", function () {
        otevriFormularMilniku(null);
      });
      oddil.appendChild(pridat);
    }

    return oddil;
  }

  function vytvorPripnutouNavstevu(n) {
    var odkaz = document.createElement("a");
    odkaz.className = "osa-navsteva stav-" + n.stav;
    odkaz.href = "#navstevy";

    var typy = (n.typ || [])
      .map(function (t) {
        return TYP_NAVSTEVY[t] || t;
      })
      .join(", ");
    odkaz.textContent = "Natáčení č. " + n.cislo + " — " + typy + " · " + (STAV_NAVSTEVY[n.stav] || n.stav);

    return odkaz;
  }

  function vytvorUzel(m, navstevy) {
    var polozka = document.createElement("div");
    polozka.className = "osa-polozka";
    // Kotva pro proklik z původního harmonogramu vpravo (viz skocNaMilnik).
    polozka.setAttribute("data-milnik", m.id);
    uzlyMilniku[m.id] = polozka;

    var tecka = document.createElement("div");
    tecka.className = "osa-uzel stav-" + m.stav;
    polozka.appendChild(tecka);

    var hl = document.createElement("div");
    hl.className = "karta-hlavicka";
    var nazev = document.createElement("h3");
    nazev.className = "karta-nadpis";
    nazev.textContent = m.nazev;
    hl.appendChild(nazev);
    var stitek = document.createElement("span");
    stitek.className = "stitek stav-" + m.stav;
    stitek.textContent = STAV_MILNIKU[m.stav] || m.stav;
    hl.appendChild(stitek);
    polozka.appendChild(hl);

    var datum = document.createElement("p");
    datum.className = "karta-meta";
    datum.textContent = datumMilniku(m);
    polozka.appendChild(datum);

    if (m.popis) {
      var popis = document.createElement("p");
      popis.className = "karta-popis";
      popis.textContent = m.popis;
      polozka.appendChild(popis);
    }

    // Doslovné znění řádku z harmonogramu PORR — ať je vždycky vidět, co přesně
    // poslali, a nedá se to splést s naší interpretací.
    if (m.zdroj_text) {
      var citace = document.createElement("blockquote");
      citace.className = "citace-zdroje";
      citace.textContent = m.zdroj_text;
      polozka.appendChild(citace);
    }

    if (m.zdroj) {
      var zdroj = document.createElement("p");
      zdroj.className = "karta-meta";
      zdroj.textContent = "Zdroj: " + m.zdroj;
      polozka.appendChild(zdroj);
    }

    if (m.poznamka) {
      var pozn = document.createElement("p");
      pozn.className = "karta-meta";
      pozn.textContent = m.poznamka;
      polozka.appendChild(pozn);
    }

    var pripnute = navstevy.filter(function (n) {
      return n.milnik_id === m.id;
    });
    pripnute.forEach(function (n) {
      polozka.appendChild(vytvorPripnutouNavstevu(n));
    });

    if (Auth.can("plan.upravit")) {
      var akce = document.createElement("div");
      akce.className = "karta-akce";
      var upravit = document.createElement("button");
      upravit.type = "button";
      upravit.className = "btn btn-mala btn-sekundarni";
      upravit.textContent = "Upravit";
      upravit.addEventListener("click", function () {
        otevriFormularMilniku(m);
      });
      akce.appendChild(upravit);
      polozka.appendChild(akce);
    }

    polozka.appendChild(vytvorKomentare(m.id));

    return polozka;
  }

  function vytvorOsu(milniky, navstevy) {
    var oddil = document.createElement("section");
    oddil.className = "oddil";

    if (!milniky.length) {
      var prazdno = document.createElement("div");
      prazdno.className = "prazdny-stav";
      var ikona = document.createElement("div");
      ikona.className = "prazdny-stav-ikona";
      var text = document.createElement("p");
      text.className = "prazdny-stav-text";
      text.textContent = "Zatím nejsou zavedené žádné milníky.";
      prazdno.appendChild(ikona);
      prazdno.appendChild(text);
      oddil.appendChild(prazdno);
      return oddil;
    }

    var osa = document.createElement("div");
    osa.className = "casova-osa";

    var razene = milniky.slice().sort(function (a, b) {
      if (a.datum_od < b.datum_od) return -1;
      if (a.datum_od > b.datum_od) return 1;
      return (a.poradi || 0) - (b.poradi || 0);
    });

    var dnes = dnesIso();
    var vlozenoDnes = false;
    var posledniRok = null;

    razene.forEach(function (m) {
      if (!vlozenoDnes && m.datum_od > dnes) {
        var dnesEl = document.createElement("div");
        dnesEl.className = "osa-dnesek";
        dnesEl.title = "Dnes · " + Util.formatDatum(dnes, "presne");
        osa.appendChild(dnesEl);
        vlozenoDnes = true;
      }
      if (m.rok !== posledniRok) {
        var h = document.createElement("h3");
        h.className = "osa-rok";
        h.textContent = String(m.rok);
        osa.appendChild(h);
        posledniRok = m.rok;
      }
      osa.appendChild(vytvorUzel(m, navstevy));
    });

    if (!vlozenoDnes) {
      var dnesKonec = document.createElement("div");
      dnesKonec.className = "osa-dnesek";
      dnesKonec.title = "Dnes · " + Util.formatDatum(dnes, "presne");
      osa.appendChild(dnesKonec);
    }

    oddil.appendChild(osa);
    return oddil;
  }


  // ---------------------------------------------------------------------
  // Pravy sloupec — CELY puvodni harmonogram od PORR (citace)
  //
  // Doslovny text bere z globalu App.obsah("harmonogram") (js/harmonogram.js).
  // Radek dokumentu se paruje s nasim milnikem pres pole zdroj_text; kdyz
  // sedi, je radek klikatelny a skoci na milnik v ose vlevo.
  // ---------------------------------------------------------------------

  // Porovnani je zamerne shovivave: sjednoti ruzne pomlcky (–, —, −),
  // nedelitelne mezery a velikost pismen. Dokument je psany rukou, nase
  // zdroj_text v plan.json taky — presna rovnost na znak by parovani
  // rozbila kvuli jedine mezere navic.
  // Dokument je teď obyčejná data (privátní repo), ne objekt s metodami —
  // druh řádku si dopočítáme tady.
  function druhRadkuDokumentu(radek, index) {
    if (index === 0) return "nadpis";
    if (/^\s*(19|20)\d{2}\s*$/.test(String(radek || ""))) return "rok";
    return "polozka";
  }

  function normalizujRadek(text) {
    return String(text || "")
      .replace(/[\u2010-\u2015\u2212]/g, "-")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function najdiMilnikyProRadek(radek, milniky) {
    var hledany = normalizujRadek(radek);
    if (!hledany) return [];
    return milniky.filter(function (m) {
      return m.zdroj_text && normalizujRadek(m.zdroj_text) === hledany;
    });
  }

  // Skok na milnik v levem sloupci + kratke zvyrazneni, at je videt, kam
  // to doskocilo (na mobilu je osa nad dokumentem, takze se roluje nahoru).
  function skocNaMilnik(id) {
    var uzel = uzlyMilniku[id];
    if (!uzel || !uzel.isConnected) {
      uzel = null;
      var vsechny = document.querySelectorAll(".osa-polozka");
      for (var i = 0; i < vsechny.length; i++) {
        if (vsechny[i].getAttribute("data-milnik") === id) {
          uzel = vsechny[i];
          break;
        }
      }
    }
    if (!uzel) return;

    if (casovacZvyrazneni) {
      window.clearTimeout(casovacZvyrazneni);
      casovacZvyrazneni = null;
    }
    if (zvyraznenyUzel) zvyraznenyUzel.classList.remove("osa-polozka-zvyraznena");

    uzel.scrollIntoView({ behavior: "smooth", block: "center" });
    uzel.classList.add("osa-polozka-zvyraznena");
    zvyraznenyUzel = uzel;
    casovacZvyrazneni = window.setTimeout(function () {
      uzel.classList.remove("osa-polozka-zvyraznena");
      if (zvyraznenyUzel === uzel) zvyraznenyUzel = null;
      casovacZvyrazneni = null;
    }, 1800);
  }

  function vytvorRadekDokumentu(radek, index, milniky, dokument) {
    var druh = druhRadkuDokumentu(radek, index);

    if (druh === "nadpis") {
      return App.el("p", "harmonogram-nazev", radek);
    }
    if (druh === "rok") {
      return App.el("h4", "harmonogram-rok", radek);
    }

    var shody = najdiMilnikyProRadek(radek, milniky);
    if (!shody.length) {
      // Radek, ke kteremu nas milnik neni (nebo ma jinak psany zdroj_text) —
      // zustava jen jako text, at se necenzuruje a nepredstira proklik.
      return App.el("p", "harmonogram-radek", radek);
    }

    var tlacitko = App.el("button", "harmonogram-radek harmonogram-radek-klikaci", radek);
    tlacitko.type = "button";
    tlacitko.title =
      shody.length > 1
        ? "Skočit na milník: " + shody[0].nazev + " (v plánu je k tomuto řádku " + shody.length + " milníky)"
        : "Skočit na milník: " + shody[0].nazev;
    tlacitko.addEventListener("click", function () {
      skocNaMilnik(shody[0].id);
    });
    return tlacitko;
  }

  function vytvorPanelZdroje(milniky) {
    var dokument = App.obsah("harmonogram");
    // Bez zapeceneho dokumentu (nenacteny js/harmonogram.js) sekce jen
    // vynecha pravy sloupec — nikdy kvuli tomu nespadne.
    if (!dokument || !Array.isArray(dokument.radky) || !dokument.radky.length) return null;

    var oddil = App.el("section", "oddil plan-sloupec plan-sloupec-zdroj");

    var uvod = App.el(
      "p",
      "plan-zdroj-uvod",
      "Takhle nám harmonogram přišel. Náš plán vlevo z něj vychází, jen je seřazený chronologicky a doplněný o naše návštěvy."
    );
    oddil.appendChild(uvod);

    var panel = document.createElement("details");
    panel.className = "harmonogram-panel";
    panel.open = panelZdrojeOtevreny;
    panel.addEventListener("toggle", function () {
      panelZdrojeOtevreny = panel.open;
    });

    var shrnuti = document.createElement("summary");
    shrnuti.className = "harmonogram-summary";
    shrnuti.textContent = "Původní harmonogram od PORR";
    panel.appendChild(shrnuti);

    var telo = App.el("div", "harmonogram-telo");

    var radky = App.el("div", "harmonogram-radky");
    dokument.radky.forEach(function (radek, index) {
      radky.appendChild(vytvorRadekDokumentu(radek, index, milniky, dokument));
    });
    telo.appendChild(radky);

    // "od Lucie Obdržálkové" je 2. pád — v datech je jmeno v 1. pádu i s
    // oddelenim (App.obsah("harmonogram").od), to jde do tooltipu.
    var zdroj = App.el(
      "p",
      "harmonogram-zdroj",
      "Zdroj: " + dokument.soubor + ", od Lucie Obdržálkové, " + Util.formatDatum(dokument.ziskano, "presne")
    );
    if (dokument.od) zdroj.title = "Od: " + dokument.od;
    telo.appendChild(zdroj);

    panel.appendChild(telo);
    oddil.appendChild(panel);
    return oddil;
  }

  function vykresli(kontejnerParam) {
    var kontejner = kontejnerParam || document.getElementById("obsah");
    if (!kontejner) return;

    var milniky = ziskejPolozky("plan").filter(function (m) {
      return !m.smazano;
    });
    var navstevy = ziskejPolozky("navstevy").filter(function (n) {
      return !n.smazano;
    });

    while (kontejner.firstChild) kontejner.removeChild(kontejner.firstChild);
    kontejner.appendChild(vytvorHlavicku(milniky));

    // Uzly se registruji az pri stavbe osy — mapa z minuleho vykresleni uz
    // ukazuje na odpojene prvky.
    uzlyMilniku = {};
    zvyraznenyUzel = null;

    var osa = vytvorOsu(milniky, navstevy);
    var panel = vytvorPanelZdroje(milniky);

    if (!panel) {
      kontejner.appendChild(osa);
      return;
    }

    // "Fifty fifty": vlevo nase osa, vpravo dokument od PORR. Pod 900 px
    // to styles.css sesype pod sebe — v tomto poradi, tedy nas plan prvni.
    osa.classList.add("plan-sloupec", "plan-sloupec-nas");
    var mrizka = App.el("div", "plan-dvousloupec");
    mrizka.appendChild(osa);
    mrizka.appendChild(panel);
    kontejner.appendChild(mrizka);
  }

  App.registrujSekci("plan", vykresli);
})();
