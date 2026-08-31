/* js/view-pripominky.js — sekce „Připomínky" (nefunguje / úprava / dotaz).
 *
 * Jedno místo, kam kdokoli napíše, že něco nejde, že by něco chtěl jinak,
 * nebo se na něco zeptá. Nahrazuje to, co by se jinak řešilo v SMS a mailech.
 *
 * Data: data/pripominky.json, obálka { verze, zmeneno, zmenil, polozky }.
 * Položka: { id, cislo, druh, nazev, popis, kde, stav, zavaznost, kdo, kdy,
 *            vyresil, vyreseno_kdy, odpoved, zminky, smazano }
 *
 * `zminky` je pole os-id lidí, kterým má o připomínce přijít upozornění na
 * mail (rozesílá ho GitHub Action nad datovým repem — appka mail odeslat
 * neumí). Starší záznamy pole nemají, chybějící = prázdné (Util.zminky).
 * Když někdo připomínku vyřeší, přidá se mezi zmínky její autor, ať se
 * dozví, že je hotová.
 *
 * Práva: pripominky.pridat (superadmin/admin/editor) = smí zapsat připomínku
 *        pripominky.resit  (superadmin/admin)        = smí měnit stav a odpovídat
 *
 * ČTENÁŘI mají read-only token — zápis jim technicky
 * nemůže projít. Místo mrtvého tlačítka dostanou stejný formulář, který jim
 * text připraví do schránky a otevře rozepsaný mail Honzovi. Je to poctivější
 * než tvářit se, že to uloží, a použitelnější než nic. Až bude potřeba, aby
 * psali přímo, stačí jim změnit roli přes scripts/nastav_pristup.py --pridej.
 *
 * Nevystavuje žádný globální objekt — registruje se jako sekce "pripominky".
 */

(function () {
  "use strict";

  var esc = Util.esc;

  var DRUHY = [
    { kod: "nejde", nazev: "Něco nejde", popis: "Něco je rozbité nebo se to chová jinak, než má." },
    { kod: "uprava", nazev: "Návrh úpravy", popis: "Funguje to, ale šlo by to udělat líp." },
    { kod: "dotaz", nazev: "Dotaz", popis: "Nevím, jak na to, nebo si nejsem jistý." }
  ];

  var STAVY = [
    { kod: "nova", nazev: "Nová", barva: "var(--varovani)" },
    { kod: "resi-se", nazev: "Řeší se", barva: "var(--modra-porr)" },
    { kod: "hotovo", nazev: "Vyřešeno", barva: "var(--ok)" },
    { kod: "zamitnuto", nazev: "Neřešíme", barva: "var(--text-slaby)" }
  ];

  var FILTRY = [
    { kod: "otevrene", nazev: "Otevřené" },
    { kod: "vse", nazev: "Vše" },
    { kod: "nejde", nazev: "Něco nejde" },
    { kod: "moje", nazev: "Moje" }
  ];

  var aktivniFiltr = "otevrene";

  // ---- pomocné ----

  function polozky() {
    return App.polozky("pripominky").filter(function (p) { return !p.smazano; });
  }

  function popisDruhu(kod) {
    for (var i = 0; i < DRUHY.length; i++) if (DRUHY[i].kod === kod) return DRUHY[i];
    return DRUHY[2];
  }

  function popisStavu(kod) {
    for (var i = 0; i < STAVY.length; i++) if (STAVY[i].kod === kod) return STAVY[i];
    return STAVY[0];
  }

  function smiPsat() { return Auth.can("pripominky.pridat"); }
  function smiResit() { return Auth.can("pripominky.resit"); }

  function mojeOsobaId() {
    return (Auth.ja && Auth.ja.osoba_id) || null;
  }

  function dalsiCislo() {
    var max = 0;
    App.polozky("pripominky").forEach(function (p) {
      if (typeof p.cislo === "number" && p.cislo > max) max = p.cislo;
    });
    return max + 1;
  }

  // Seznam sekcí, kterých se připomínka může týkat — ať se nepíše volným textem
  // a dá se pak filtrovat.
  var SEKCE_KDE = ["Přehled", "Návštěvy", "Plán stavby", "Časosběr", "Materiály",
    "Materiál pro Emauzy", "Tým", "Koš", "Správa", "Něco jiného"];

  // ---- text pro čtenáře (do schránky a do mailu) ----

  function textPripominky(data) {
    var radky = [];
    radky.push("Kokpit Pragerovy kostky — " + popisDruhu(data.druh).nazev.toLowerCase());
    radky.push("");
    radky.push("Čeho se to týká: " + (data.kde || "neuvedeno"));
    radky.push("Stručně: " + data.nazev);
    if (data.popis) {
      radky.push("");
      radky.push(data.popis);
    }
    if (data.zavaznost === "blokuje") {
      radky.push("");
      radky.push("POZOR: tohle mi brání v práci.");
    }
    var radekZminek = Util.zminkyText(data.zminky);
    if (radekZminek) {
      radky.push("");
      radky.push(radekZminek);
    }
    radky.push("");
    var ja = Auth.ja && Auth.ja.jmeno ? Auth.ja.jmeno : "";
    if (ja) radky.push("Píše: " + ja);
    return radky.join("\n");
  }

  // ---- formulář ----

  function otevriFormular(existujici) {
    var jeNova = !existujici;
    var form = document.createElement("form");
    form.className = "formular";
    form.addEventListener("submit", function (e) { e.preventDefault(); });

    function pole(popisek, prvek, napoveda) {
      var obal = App.el("div", "pole");
      var lab = App.el("label", null, popisek);
      var id = "pri-" + Math.random().toString(36).slice(2, 8);
      lab.setAttribute("for", id);
      prvek.id = id;
      prvek.className = (prvek.className || "") + " vstup";
      obal.appendChild(lab);
      obal.appendChild(prvek);
      if (napoveda) obal.appendChild(App.el("p", "napoveda", napoveda));
      form.appendChild(obal);
      return prvek;
    }

    var vyberDruhu = document.createElement("select");
    DRUHY.forEach(function (d) {
      var o = document.createElement("option");
      o.value = d.kod;
      o.textContent = d.nazev;
      vyberDruhu.appendChild(o);
    });
    vyberDruhu.value = existujici ? existujici.druh : "nejde";
    pole("O co jde?", vyberDruhu);

    var napovedaDruhu = App.el("p", "napoveda", popisDruhu(vyberDruhu.value).popis);
    form.appendChild(napovedaDruhu);
    vyberDruhu.addEventListener("change", function () {
      napovedaDruhu.textContent = popisDruhu(vyberDruhu.value).popis;
    });

    var vyberKde = document.createElement("select");
    SEKCE_KDE.forEach(function (s) {
      var o = document.createElement("option");
      o.value = s;
      o.textContent = s;
      vyberKde.appendChild(o);
    });
    vyberKde.value = existujici ? (existujici.kde || "Něco jiného") : "Něco jiného";
    pole("Kde se to stalo?", vyberKde);

    var vstupNazev = document.createElement("input");
    vstupNazev.type = "text";
    vstupNazev.maxLength = 120;
    vstupNazev.value = existujici ? existujici.nazev : "";
    vstupNazev.placeholder = "Jednou větou, o co jde";
    pole("Stručně", vstupNazev);

    var vstupPopis = document.createElement("textarea");
    vstupPopis.rows = 5;
    vstupPopis.value = existujici ? existujici.popis : "";
    vstupPopis.placeholder = "Co jste dělal(a), co se stalo a co jste čekal(a), že se stane.";
    pole("Podrobněji", vstupPopis, "Čím konkrétnější, tím rychleji to spravíme.");

    var vstupBlokuje = document.createElement("input");
    vstupBlokuje.type = "checkbox";
    vstupBlokuje.checked = existujici ? existujici.zavaznost === "blokuje" : false;
    var obalBlokuje = App.el("label", "pole-zaskrtavatko");
    obalBlokuje.appendChild(vstupBlokuje);
    obalBlokuje.appendChild(document.createTextNode(" Brání mi to v práci"));
    form.appendChild(obalBlokuje);

    // Koho o připomínce upozornit mailem. Sám sebe si člověk neoznačuje —
    // kdo píše, ten upozornění nedostává.
    var vyberZminek = Util.vyberZminek({
      vybrane: Util.zminky(existujici),
      vynech: mojeOsobaId()
    });
    form.appendChild(vyberZminek.prvek);

    function sesbirej() {
      return {
        druh: vyberDruhu.value,
        kde: vyberKde.value,
        nazev: vstupNazev.value.trim(),
        popis: vstupPopis.value.trim(),
        zavaznost: vstupBlokuje.checked ? "blokuje" : "bezna",
        zminky: vyberZminek.vybrane()
      };
    }

    var akce = [{ text: "Zavřít", druh: "sekundarni", fn: function () { modal.zavri(); } }];

    if (smiPsat()) {
      akce.push({
        text: jeNova ? "Odeslat" : "Uložit",
        druh: "primarni",
        fn: function () {
          var data = sesbirej();
          if (data.nazev.length < 3) {
            App.toast("Napište aspoň krátce, o co jde.", "chyba");
            return;
          }
          uloz(jeNova, existujici, data).then(function (ok) {
            if (ok) modal.zavri();
          });
        }
      });
    } else {
      // Čtenář — read-only token, zápis by neprošel. Připravíme text.
      akce.push({
        text: "Zkopírovat a poslat mailem",
        druh: "primarni",
        fn: function () {
          var data = sesbirej();
          if (data.nazev.length < 3) {
            App.toast("Napište aspoň krátce, o co jde.", "chyba");
            return;
          }
          var text = textPripominky(data);
          Util.doSchranky(text).then(function (ok) {
            App.toast(ok ? "Text zkopírován." : "Text se nepodařilo zkopírovat.", ok ? "ok" : "chyba");
          });
          var predmet = "Kokpit Pragerovy kostky — " + data.nazev;
          window.location.href = "mailto:honza@frantisekdron.cz?subject=" +
            encodeURIComponent(predmet) + "&body=" + encodeURIComponent(text);
        }
      });
    }

    if (!jeNova && smiResit()) {
      akce.push({
        text: "Smazat (do koše)",
        druh: "nebezpecny",
        fn: function () {
          modal.zavri();
          smaz(existujici);
        }
      });
    }

    if (!smiPsat()) {
      var vysvetleni = App.el("p", "napoveda",
        "Máte přístup jen ke čtení, takže zápis přímo do kokpitu vám neprojde. " +
        "Tlačítko níž vám připomínku připraví do schránky a otevře rozepsaný " +
        "e-mail — stačí odeslat.");
      form.appendChild(vysvetleni);
    }

    var modal = App.modal({
      nadpis: jeNova ? "Nová připomínka" : "Připomínka č. " + existujici.cislo,
      obsah: form,
      akce: akce
    });
    return modal;
  }

  // ---- zápisy ----

  function uloz(jeNova, existujici, data) {
    var popisZmeny;
    return GH.zmen("pripominky", function (pol) {
      if (jeNova) {
        pol.push({
          id: GH.noveId("pri"),
          cislo: dalsiCislo(),
          druh: data.druh,
          nazev: data.nazev,
          popis: data.popis,
          kde: data.kde,
          stav: "nova",
          zavaznost: data.zavaznost,
          kdo: mojeOsobaId(),
          kdy: new Date().toISOString(),
          vyresil: null,
          vyreseno_kdy: null,
          odpoved: "",
          zminky: data.zminky || [],
          smazano: null
        });
        popisZmeny = "Nová připomínka: " + data.nazev;
      } else {
        var cil = pol.find(function (p) { return p.id === existujici.id; });
        if (!cil) return;
        cil.druh = data.druh;
        cil.nazev = data.nazev;
        cil.popis = data.popis;
        cil.kde = data.kde;
        cil.zavaznost = data.zavaznost;
        cil.zminky = data.zminky || [];
        popisZmeny = "Upravena připomínka č. " + cil.cislo;
      }
    }, popisZmeny || "Připomínka")
      .then(function (obsah) {
        App.uloz("pripominky", obsah);
        App.toast(jeNova ? "Připomínka odeslána." : "Uloženo.", "ok");
        App.prekresli();
        return true;
      })
      .catch(function (chyba) {
        App.toast(chyba && chyba.message ? chyba.message : "Uložení se nepovedlo.", "chyba");
        return false;
      });
  }

  function zmenStav(polozka, novyStav, odpoved) {
    return GH.zmen("pripominky", function (pol) {
      var cil = pol.find(function (p) { return p.id === polozka.id; });
      if (!cil) return;
      cil.stav = novyStav;
      if (typeof odpoved === "string") cil.odpoved = odpoved;
      if (novyStav === "hotovo" || novyStav === "zamitnuto") {
        cil.vyresil = mojeOsobaId();
        cil.vyreseno_kdy = new Date().toISOString();
        // Autor se musí dozvědět, že je jeho připomínka vyřízená — označíme
        // ho tedy sami. Upozornění posíláme i bez odpovědi: "hotovo" bez
        // vysvětlení je pořád zpráva, kterou ten člověk potřebuje. Sám sobě
        // ho ale nikdo neposílá.
        var autor = cil.kdo;
        var stavajici = Util.zminky(cil);
        if (autor && autor !== mojeOsobaId() && stavajici.indexOf(autor) === -1) {
          cil.zminky = stavajici.concat([autor]);
        } else {
          cil.zminky = stavajici;
        }
      } else {
        cil.vyresil = null;
        cil.vyreseno_kdy = null;
      }
    }, "Připomínka č. " + polozka.cislo + " — " + popisStavu(novyStav).nazev)
      .then(function (obsah) {
        App.uloz("pripominky", obsah);
        App.prekresli();
      })
      .catch(function (chyba) {
        App.toast(chyba && chyba.message ? chyba.message : "Uložení se nepovedlo.", "chyba");
      });
  }

  function smaz(polozka) {
    App.potvrd("Přesunout připomínku č. " + polozka.cislo + " do koše?").then(function (ano) {
      if (!ano) return;
      GH.zmen("pripominky", function (pol) {
        var cil = pol.find(function (p) { return p.id === polozka.id; });
        if (cil) cil.smazano = { kdy: new Date().toISOString(), kdo: mojeOsobaId() };
      }, "Připomínka č. " + polozka.cislo + " do koše")
        .then(function (obsah) {
          App.uloz("pripominky", obsah);
          App.toast("Přesunuto do koše.", "ok");
          App.prekresli();
        })
        .catch(function (chyba) {
          App.toast(chyba && chyba.message ? chyba.message : "Uložení se nepovedlo.", "chyba");
        });
    });
  }

  // ---- vykreslení ----

  function kartaPripominky(p) {
    var stav = popisStavu(p.stav);
    var karta = App.el("div", "karta karta-pripominka");
    karta.style.setProperty("--stav-barva", stav.barva);

    var hlavicka = App.el("div", "karta-hlavicka");
    var kontrolka = App.el("span", "sync-tecka pripominka-tecka");
    kontrolka.style.background = stav.barva;
    kontrolka.setAttribute("aria-hidden", "true");
    hlavicka.appendChild(kontrolka);

    var nadpis = App.el("h3", "karta-nadpis",
      "č. " + p.cislo + " — " + (p.nazev || "(bez názvu)"));
    hlavicka.appendChild(nadpis);
    karta.appendChild(hlavicka);

    var stitky = App.el("div", "dlazdice-stitky");
    var stitekStav = App.el("span", "stitek", stav.nazev);
    stitekStav.style.color = stav.barva;
    stitky.appendChild(stitekStav);
    stitky.appendChild(App.el("span", "stitek", popisDruhu(p.druh).nazev));
    if (p.kde) stitky.appendChild(App.el("span", "stitek", p.kde));
    if (p.zavaznost === "blokuje") {
      stitky.appendChild(App.el("span", "stitek stitek-chyba", "brání v práci"));
    }
    karta.appendChild(stitky);

    if (p.popis) karta.appendChild(App.el("p", "karta-popis", p.popis));

    var kdo = App.jmenoOsoby(p.kdo);
    karta.appendChild(App.el("p", "karta-meta",
      "Napsal(a) " + kdo + " · " + Util.formatCas(p.kdy)));

    if (p.odpoved) {
      var odp = App.el("div", "karta-odpoved");
      odp.appendChild(App.el("strong", null, "Odpověď: "));
      odp.appendChild(document.createTextNode(p.odpoved));
      karta.appendChild(odp);
    }
    if (p.vyresil) {
      karta.appendChild(App.el("p", "karta-meta",
        "Vyřídil(a) " + App.jmenoOsoby(p.vyresil) + " · " + Util.formatCas(p.vyreseno_kdy)));
    }

    var radekZminek = Util.radekZminek(Util.zminky(p));
    if (radekZminek) karta.appendChild(radekZminek);

    var akce = App.el("div", "karta-akce");

    if (smiResit()) {
      var vyberStavu = document.createElement("select");
      vyberStavu.className = "vstup";
      vyberStavu.setAttribute("aria-label", "Stav připomínky č. " + p.cislo);
      STAVY.forEach(function (s) {
        var o = document.createElement("option");
        o.value = s.kod;
        o.textContent = s.nazev;
        vyberStavu.appendChild(o);
      });
      vyberStavu.value = p.stav;
      vyberStavu.addEventListener("change", function () {
        var novy = vyberStavu.value;
        if (novy === "hotovo" || novy === "zamitnuto") {
          var pole = document.createElement("textarea");
          pole.rows = 3;
          pole.className = "vstup";
          pole.value = p.odpoved || "";
          pole.placeholder = novy === "hotovo"
            ? "Co jsme s tím udělali."
            : "Proč to neřešíme.";
          var obal = App.el("div", "formular");
          var lab = App.el("label", null, "Odpověď (nepovinná)");
          obal.appendChild(lab);
          obal.appendChild(pole);
          var m = App.modal({
            nadpis: popisStavu(novy).nazev + " — připomínka č. " + p.cislo,
            obsah: obal,
            akce: [
              { text: "Zrušit", druh: "sekundarni", fn: function () {
                vyberStavu.value = p.stav; m.zavri();
              } },
              { text: "Uložit", druh: "primarni", fn: function () {
                m.zavri(); zmenStav(p, novy, pole.value.trim());
              } }
            ]
          });
        } else {
          zmenStav(p, novy);
        }
      });
      akce.appendChild(vyberStavu);
    }

    var muzeUpravit = smiPsat() && (smiResit() || p.kdo === mojeOsobaId());
    if (muzeUpravit) {
      var btnUpravit = App.el("button", "btn btn-mala btn-sekundarni", "Upravit");
      btnUpravit.type = "button";
      btnUpravit.addEventListener("click", function () { otevriFormular(p); });
      akce.appendChild(btnUpravit);
    }

    if (akce.childNodes.length) karta.appendChild(akce);
    return karta;
  }

  function vykresli(kontejner) {
    kontejner.innerHTML = "";

    var vsechny = polozky();

    var hlavicka = App.el("div", "sekce-hlavicka");
    hlavicka.appendChild(App.el("h2", "nadpis-sekce", "Připomínky"));
    hlavicka.appendChild(App.el("p", "podnadpis-sekce",
      "Něco nejde, nebo byste to chtěli jinak? Napište to sem — je to jedno " +
      "místo pro všechny místo esemesek a mailů."));
    kontejner.appendChild(hlavicka);

    var otevrenych = vsechny.filter(function (p) {
      return p.stav === "nova" || p.stav === "resi-se";
    }).length;
    var blokujicich = vsechny.filter(function (p) {
      return p.zavaznost === "blokuje" && (p.stav === "nova" || p.stav === "resi-se");
    }).length;

    var souhrn = App.el("p", "karta-meta",
      "Otevřených: " + otevrenych + " z " + vsechny.length +
      (blokujicich ? " · z toho " + blokujicich + " někomu brání v práci" : ""));
    kontejner.appendChild(souhrn);

    var pruhAkci = App.el("div", "karta-akce");
    var btnNova = App.el("button", "btn btn-primarni",
      smiPsat() ? "+ Napsat připomínku" : "+ Napsat připomínku (pošle se mailem)");
    btnNova.type = "button";
    btnNova.addEventListener("click", function () { otevriFormular(null); });
    pruhAkci.appendChild(btnNova);
    kontejner.appendChild(pruhAkci);

    // filtry s počty
    var pruhFiltru = App.el("div", "galerie-filtr");
    FILTRY.forEach(function (f) {
      var kolik = filtruj(vsechny, f.kod).length;
      var tl = App.el("button", "filtr-tlacitko" +
        (aktivniFiltr === f.kod ? " filtr-tlacitko-aktivni" : ""),
        f.nazev + " (" + kolik + ")");
      tl.type = "button";
      tl.setAttribute("aria-pressed", aktivniFiltr === f.kod ? "true" : "false");
      tl.addEventListener("click", function () {
        if (aktivniFiltr === f.kod) return;
        aktivniFiltr = f.kod;
        vykresli(kontejner);
      });
      pruhFiltru.appendChild(tl);
    });
    kontejner.appendChild(pruhFiltru);

    var vyfiltrovane = filtruj(vsechny, aktivniFiltr);

    if (!vyfiltrovane.length) {
      var prazdno = App.el("div", "prazdny-stav");
      prazdno.appendChild(App.el("p", null, vsechny.length
        ? "Tomuto filtru neodpovídá žádná připomínka."
        : "Zatím tu nic není. To je dobře — a kdyby něco přestalo fungovat, napište to sem."));
      kontejner.appendChild(prazdno);
      return;
    }

    // otevřené nahoru, uvnitř nejnovější první
    vyfiltrovane.sort(function (a, b) {
      var poradiStavu = { "nova": 0, "resi-se": 1, "hotovo": 2, "zamitnuto": 3 };
      var rozdil = (poradiStavu[a.stav] || 0) - (poradiStavu[b.stav] || 0);
      if (rozdil) return rozdil;
      return String(b.kdy || "").localeCompare(String(a.kdy || ""));
    });

    var seznam = App.el("div", "karty-mrizka");
    vyfiltrovane.forEach(function (p) { seznam.appendChild(kartaPripominky(p)); });
    kontejner.appendChild(seznam);
  }

  function filtruj(vsechny, kod) {
    if (kod === "vse") return vsechny.slice();
    if (kod === "nejde") return vsechny.filter(function (p) { return p.druh === "nejde"; });
    if (kod === "moje") {
      var ja = mojeOsobaId();
      return vsechny.filter(function (p) { return p.kdo === ja; });
    }
    return vsechny.filter(function (p) {
      return p.stav === "nova" || p.stav === "resi-se";
    });
  }

  App.registrujSekci("pripominky", vykresli);
})();
