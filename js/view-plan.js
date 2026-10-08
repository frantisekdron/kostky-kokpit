/*
 * view-plan.js — sekce "Plán stavby" (KONTRAKT.md §9.3) kokpitu Pragerovy kostky.
 *
 * PŘESTAVBA 8. 10. 2026 podle zadání majitele „předělej v duchu Návštěv, ale
 * moderně, ať to má šťávu a je to velmi funkční“. Dřív to byl dlouhý sloupec
 * karet s osou a vedle něj celý dokument od PORR. Teď je sekce poskládaná ze
 * čtyř vrstev shora dolů a veškerý detail je v BOČNÍM PANELU (stejný jazyk
 * jako v Návštěvách, dialog s třídou nv-panel):
 *
 *   1) hlavička — „Plán stavby“, vpravo „Harmonogram PORR“ (otevře původní
 *      dokument v panelu) a „+ Milník“;
 *   2) hero „Teď na stavbě“ — probíhající milník (nebo poslední hotový),
 *      velký odpočet k dalšímu milníku, segmentový ukazatel (jeden segment =
 *      jeden milník, klik otevře detail) a řádek „Hotovo X z N · předání …“;
 *      když je některý milník po termínu, přibude žlutý řádek s tlačítkem;
 *   3) časový pás — vodorovná osa od zahájení do předání: tečky milníků,
 *      pod nimi značky našich natáčení, čára „Dnes“, konec smlouvy a předání.
 *      Na mobilu se pás vodorovně posouvá a je rovnou odrolovaný k „Dnes“;
 *   4) tabulka milníků po letech — lísteček s měsícem, název s datem v
 *      původním znění PORR, čipy navázaných návštěv, „kdy“ a stav. Mezi
 *      minulostí a budoucností je řádek „Dnes“. Klik na řádek = detail.
 *
 * Datum milníku se VŽDY vypisuje doslova z pole datum_slovy („konec 09/2026“,
 * „cca polovina 10/2026“) — Franta trvá na znění, jak ho napsal PORR.
 * ISO datum_od/datum_do slouží jen k řazení a k umístění na časovém pásu.
 *
 * Detail milníku v panelu: velké datum, přepínač stavu (jeden klik uloží),
 * popis, citace z harmonogramu PORR, poznámka, navázaná natáčení se
 * „Co natočíme“ (jen ke čtení — upravuje se v Návštěvách) a komentáře.
 * Panel se při pollingu dat NEZAVÍRÁ: překreslí se jen jeho obsah, přitom
 * zůstane pozice rolování, fokus i rozepsaný komentář.
 *
 * Práva: `plan.upravit` = přidat/upravit milník, přepínač stavu, smazat;
 * `komentare.pridat` = psát komentáře (zapisují se přímo do aktivita.json,
 * entita:"milnik"). Komentář může někoho OZNAČIT — pole `zminky` (pole
 * os-id) v záznamu aktivity. Označenému má po zápisu přijít upozornění na
 * mail; rozesílá ho GitHub Action nad datovým repem, appka mail odeslat
 * neumí. Výběr lidí staví společná Util.vyberZminek(), řádek pod
 * komentářem Util.radekZminek(). Starší komentáře pole nemají — chybějící
 * se bere jako prázdné (Util.zminky).
 *
 * Používá skutečné App.* API z js/app.js (App.polozky(soubor) pro čtení pole
 * položek, App.obsah(soubor) pro objekt-dokument, App.uloz(soubor, obsah)
 * pro zápis celé obálky po GH.zmen — App.data drží VŽDY celou obálku, nikdy
 * se nesahá na App.data[soubor] přímo, viz hlavičkový komentář js/app.js —
 * dále App.modal({nadpis,obsah,akce}), App.potvrd, App.toast, App.prekresli).
 *
 * Nevystavuje žádný globální objekt — jen se při načtení zaregistruje jako
 * sekce 'plan' přes App.registrujSekci('plan', vykresli). Čte App.polozky
 * ("plan"/"navstevy"/"aktivita"), App.obsah("nastaveni"/"harmonogram"),
 * zapisuje přes GH.zmen('plan', ...) a GH.zmen('aktivita', ...).
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

  // Pořadí tlačítek v přepínači stavu v panelu (od „ještě nic“ po hotovo).
  var PORADI_STAVU = ["planovano", "probiha", "hotovo", "posunuto"];

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

  var MESICE_ZKR = ["led", "úno", "bře", "dub", "kvě", "čvn", "čvc", "srp", "zář", "říj", "lis", "pro"];

  // Dvě navazující návštěvy blíž než tolik procent osy by se na pásu překrývaly
  // — druhá z nich se proto posune o řádek níž (viz htmlPas).
  var MIN_ODSTUP_NATOCENI = 2.4;

  // otevrene komentare (mnozina entita_id) prezije mezi prekresleni (napr. po
  // pollingu), at se uzivateli nezavira rozbaleny panel pod rukama
  var otevreneKomentare = {};

  // Boční panel (jeden dialog pro dokument PORR i pro detail milníku).
  // Pamatujeme si, co je v něm právě otevřené, aby ho šlo po každém
  // překreslení dat obnovit a nezavřít pod rukama.
  var panel = null;              // { dlg, obsah, zavri }
  var panelRezim = null;         // "milnik" | "dokument"
  var panelMilnikId = null;
  var panelOdDokumentu = false;  // detail otevřený proklikem z dokumentu → nabídne „← Harmonogram PORR“
  var ukladaSeStav = false;      // zámek proti dvojkliku na přepínači stavu

  // Živý formulář komentáře v panelu — při překreslení z něj odečteme
  // rozepsaný text a označené lidi, ať se po pollingu neztratí.
  var formularKomentare = null;  // { textarea, vyber }

  // Vodorovná pozice rolování časového pásu — kontejner se při každém
  // překreslení smaže (viz renderObsah v app.js), takže ji držíme tady.
  var pasScrollLeft = null;

  // ---------------------------------------------------------------------
  // Cteni App.data — App.data[soubor] drzi VZDY celou obalku {verze,...,
  // polozky} (viz js/app.js). Tenky obal nad spolecnym App.polozky().
  // ---------------------------------------------------------------------

  // Datum milníku vypisujeme PŘESNĚ TAK, JAK HO NAPSALI ONI (pole datum_slovy —
  // „konec 09/2026", „cca polovina 10/2026", „03/2029–04/2029"). Franta na tom
  // trvá: jejich harmonogram je pro obě strany závazný podklad a naše
  // normalizace na „říjen 2026" mění význam. ISO datum (datum_od/datum_do)
  // slouží už jen k řazení a k umístění na časovém pásu.
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

  // Živý (nesmazaný) milník podle id — pro panel a přepínač stavu.
  function najdiMilnik(id) {
    var m = najdiPodleId(ziskejPolozky(SOUBOR), id);
    return m && !m.smazano ? m : null;
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

  function muze(kod) {
    return !!(window.Auth && typeof Auth.can === "function" && Auth.can(kod));
  }

  // ---------------------------------------------------------------------
  // Datumová a slovní pomocná matematika
  // ---------------------------------------------------------------------

  function tvarCisla(pocet, jeden, dva, vic) {
    if (pocet === 1) return jeden;
    if (pocet >= 2 && pocet <= 4) return dva;
    return vic;
  }

  function tvarMilniku(pocet) {
    return pocet + " " + tvarCisla(pocet, "milník", "milníky", "milníků");
  }

  // ISO „RRRR-MM-DD“ → pořadové číslo dne (bez časových pásem, jen kalendář).
  // Slouží k poměrům na časovém pásu; null = datum nejde přečíst.
  function dnyIso(iso) {
    var p = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!p) return null;
    return Math.round(Date.UTC(parseInt(p[1], 10), parseInt(p[2], 10) - 1, parseInt(p[3], 10)) / 86400000);
  }

  function isoZDnu(dny) {
    return new Date(dny * 86400000).toISOString().slice(0, 10);
  }

  // Datum o n měsíců později; den se přiskřípne ke konci cílového měsíce
  // (26. 8. + 28 měs. = 26. 12., 31. 1. + 1 měs. = 28. 2.).
  function pridejMesice(iso, n) {
    var p = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!p) return null;
    var celkem = parseInt(p[1], 10) * 12 + (parseInt(p[2], 10) - 1) + n;
    var rok = Math.floor(celkem / 12);
    var mesic = celkem % 12;
    var posledni = new Date(Date.UTC(rok, mesic + 1, 0)).getUTCDate();
    var den = Math.min(parseInt(p[3], 10), posledni);
    return rok + "-" + (mesic + 1 < 10 ? "0" : "") + (mesic + 1) + "-" + (den < 10 ? "0" : "") + den;
  }

  // Kolik kalendářních měsíců je od letošního měsíce k měsíci daného data
  // (0 = tento měsíc, záporné = minulost). Pro orientační termíny, kde den
  // nic neznamená.
  function mesicuDo(iso) {
    var p = /^(\d{4})-(\d{2})/.exec(String(iso || ""));
    if (!p) return null;
    var ted = new Date();
    return (parseInt(p[1], 10) * 12 + parseInt(p[2], 10)) - (ted.getFullYear() * 12 + ted.getMonth() + 1);
  }

  // „za 7 dní“ / „před 9 dny“ / „za 2 měs.“ / „za 3 roky“ podle vzdálenosti ve
  // dnech (záporné = minulost, jako Util.zaDni).
  function relativniDny(dni) {
    if (typeof dni !== "number" || isNaN(dni)) return "";
    if (dni === 0) return "dnes";
    var budouci = dni > 0;
    var abs = Math.abs(dni);
    if (abs === 1) return budouci ? "zítra" : "včera";
    if (abs < 31) return budouci ? "za " + abs + " " + tvarCisla(abs, "den", "dny", "dní") : "před " + abs + " dny";
    var mesicu = Math.max(1, Math.round(abs / 30.44));
    if (mesicu < 24) return (budouci ? "za " : "před ") + mesicu + " měs.";
    var roku = Math.max(1, Math.round(abs / 365.25));
    if (budouci) return "za " + roku + " " + tvarCisla(roku, "rok", "roky", "let");
    return "před " + roku + " " + (roku === 1 ? "rokem" : "lety");
  }

  function relativniMesice(rozdil) {
    if (rozdil === null) return "";
    if (rozdil === 0) return "tento měsíc";
    if (rozdil === 1) return "příští měsíc";
    if (rozdil === -1) return "minulý měsíc";
    var abs = Math.abs(rozdil);
    if (abs < 24) return (rozdil > 0 ? "za " : "před ") + abs + " měs.";
    var roku = Math.round(abs / 12);
    if (rozdil > 0) return "za " + roku + " " + tvarCisla(roku, "rok", "roky", "let");
    return "před " + roku + " " + (roku === 1 ? "rokem" : "lety");
  }

  // Sloupec „Kdy“ v tabulce a „za …“ v panelu. U probíhajícího „teď“; u
  // uplynulého termínu se počítá od KONCE období (kdy to mělo být hotové),
  // u budoucího od začátku. Orientační termíny (měsíc, období) se počítají po
  // kalendářních měsících — den u nich nic neznamená.
  function textZa(m, dnes) {
    if (m.stav === "probiha") return "teď";
    var od = m.datum_od;
    var konec = m.datum_do || m.datum_od;
    if (!od) return "";
    if (konec < dnes) return relativniDny(Util.zaDni(konec));
    if (od > dnes) {
      if (m.presnost === "presne") return relativniDny(Util.zaDni(od));
      return relativniMesice(mesicuDo(od));
    }
    return m.presnost === "presne" ? "dnes" : "tento měsíc";
  }

  // Velké číslo v hero: do dvou měsíců dny (34 dní se čte líp než „1 měs.“),
  // do dvou let měsíce, dál roky s jedním desetinným místem.
  function velkyOdpocet(dni) {
    if (dni <= 60) {
      var jednotkaDni = tvarCisla(dni, "den", "dny", "dní");
      return { cislo: String(dni), jednotka: jednotkaDni, popis: "Zbývá " + dni + " " + jednotkaDni };
    }
    if (dni < 730) {
      var mesicu = Math.max(1, Math.round(dni / 30.44));
      return { cislo: String(mesicu), jednotka: "měs.", popis: "Zbývá zhruba " + mesicu + " měs." };
    }
    var roky = Math.round((dni / 365.25) * 10) / 10;
    var cele = roky === Math.round(roky);
    return {
      cislo: String(roky).replace(".", ","),
      jednotka: cele ? tvarCisla(roky, "rok", "roky", "let") : "roku",
      popis: "Zbývá zhruba " + String(roky).replace(".", ",") + " roku"
    };
  }

  // „za 2 roky a 11 měs.“ — delší výraz pro předání stavby v hero.
  function textZaDlouhy(dni) {
    if (typeof dni !== "number" || isNaN(dni)) return "";
    if (dni <= 0) return relativniDny(dni);
    if (dni < 31) return "za " + dni + " " + tvarCisla(dni, "den", "dny", "dní");
    if (dni < 365) return "za " + Math.max(1, Math.round(dni / 30.44)) + " měs.";
    var roku = Math.floor(dni / 365.25);
    var zbytek = Math.round((dni - roku * 365.25) / 30.44);
    if (zbytek >= 12) {
      roku += 1;
      zbytek = 0;
    }
    return "za " + roku + " " + tvarCisla(roku, "rok", "roky", "let") + (zbytek ? " a " + zbytek + " měs." : "");
  }

  // Po termínu = ještě neskončilo (plánováno / probíhá), a přitom konec období
  // je před dneškem. Posunuté a hotové do toho nepatří — o těch už někdo
  // rozhodl.
  function jePoTerminu(m, dnes) {
    if (m.stav !== "planovano" && m.stav !== "probiha") return false;
    var konec = m.datum_do || m.datum_od;
    return !!konec && konec < dnes;
  }

  function porovnejMilniky(a, b) {
    var da = String(a.datum_od || "");
    var db = String(b.datum_od || "");
    if (da < db) return -1;
    if (da > db) return 1;
    return (a.poradi || 0) - (b.poradi || 0);
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

  // `koncept` (nepovinný) = {text, zminky} rozepsaný komentář z předchozího
  // vykreslení panelu — po pollingu se vrátí do nového formuláře.
  function vytvorKomentare(entitaId, koncept) {
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
      detail.appendChild(vytvorFormularKomentare(entitaId, koncept));
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

    var radekZminek = Util.radekZminek(Util.zminky(k));
    if (radekZminek) wrap.appendChild(radekZminek);

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

  function vytvorFormularKomentare(entitaId, koncept) {
    var form = document.createElement("form");
    form.className = "komentar-formular";

    var pole = document.createElement("div");
    pole.className = "pole";
    var textarea = document.createElement("textarea");
    textarea.rows = 2;
    textarea.name = "text";
    textarea.placeholder = "Napsat komentář k milníku…";
    if (koncept && koncept.text) textarea.value = koncept.text;
    pole.appendChild(textarea);
    form.appendChild(pole);

    // Koho o komentáři upozornit mailem. Sebe si člověk neoznačuje.
    var vyberZminek = Util.vyberZminek({
      vynech: (Auth.ja && Auth.ja.osoba_id) || null,
      vybrane: koncept && koncept.zminky ? koncept.zminky : []
    });
    form.appendChild(vyberZminek.prvek);

    var tlacitko = document.createElement("button");
    tlacitko.type = "submit";
    tlacitko.className = "btn btn-mala btn-primarni";
    tlacitko.textContent = "Přidat komentář";
    form.appendChild(tlacitko);

    // Panel si formulář pamatuje, aby z něj při překreslení uměl odečíst koncept.
    formularKomentare = { textarea: textarea, vyber: vyberZminek };

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
          zminky: vyberZminek.vybrane(),
          kdo: Auth.ja.id,
          kdy: new Date().toISOString(),
          smazano: null
        });
      })
        .then(function (vysledek) {
          App.uloz("aktivita", vysledek);
          otevreneKomentare[entitaId] = true;
          // Odesláno — koncept už neplatí, nový formulář má být prázdný.
          formularKomentare = null;
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

  // Jeden klik na přepínači stavu v panelu = hotovo. Zapisuje stejně jako
  // ulozitMilnik (GH.zmen + popis → záznam aktivity), jen mění jediné pole.
  function zmenStav(id, novyStav) {
    var m = najdiMilnik(id);
    if (!m || m.stav === novyStav || !STAV_MILNIKU[novyStav]) return;
    if (!muze("plan.upravit") || ukladaSeStav) return;
    ukladaSeStav = true;
    var puvodniNazev = m.nazev;
    GH.zmen(
      SOUBOR,
      function (polozky) {
        var p = najdiPodleId(polozky, id);
        if (!p) throw new Error("Milník nenalezen.");
        p.stav = novyStav;
      },
      'Změněn stav milníku "' + puvodniNazev + '" na „' + STAV_MILNIKU[novyStav] + '“.'
    )
      .then(function (vysledek) {
        ukladaSeStav = false;
        App.uloz("plan", vysledek);
        App.toast("Stav změněn: " + STAV_MILNIKU[novyStav] + ".", "ok");
        App.prekresli();
      })
      .catch(function (chyba) {
        ukladaSeStav = false;
        App.toast((chyba && chyba.hlaska) || "Změna stavu selhala.", "chyba");
      });
  }

  // ---------------------------------------------------------------------
  // Priprava dat — jednou na vykresleni, pouziva to cela sekce i panel
  // ---------------------------------------------------------------------

  // Rozsah časového pásu: od zahájení po předání z nastavení, případně
  // roztažený tak, aby se do něj vešly i milníky, které by z něj vyčnívaly.
  function spoctiOsu(razene, nastaveni) {
    var od = dnyIso(nastaveni.zahajeni);
    var doo = dnyIso(nastaveni.predani);
    razene.forEach(function (m) {
      var a = dnyIso(m.datum_od);
      var b = dnyIso(m.datum_do || m.datum_od);
      if (a !== null && (od === null || a < od)) od = a;
      if (b !== null && (doo === null || b > doo)) doo = b;
    });
    if (od === null || doo === null) return null;
    if (doo <= od) doo = od + 1;
    return { od: od, konec: doo };
  }

  function pripravData() {
    var milniky = ziskejPolozky("plan").filter(function (m) {
      return !m.smazano;
    });
    var navstevy = ziskejPolozky("navstevy").filter(function (n) {
      return !n.smazano;
    });
    var razene = milniky.slice().sort(porovnejMilniky);
    var dnes = dnesIso();
    var nastaveni = App.obsah("nastaveni") || {};

    // Původní dokument od PORR — bez něj se tlačítko „Harmonogram PORR“ nenabídne.
    var dok = App.obsah("harmonogram");
    var dokument = dok && Array.isArray(dok.radky) && dok.radky.length ? dok : null;

    var poTerminu = Object.create(null);
    var pocetPoTerminu = 0;
    var hotovo = 0;
    razene.forEach(function (m) {
      if (jePoTerminu(m, dnes)) {
        poTerminu[m.id] = true;
        pocetPoTerminu++;
      }
      if (m.stav === "hotovo") hotovo++;
    });

    // Návštěvy navázané na milník (pole navsteva.milnik_id), podle čísla.
    var podleMilniku = Object.create(null);
    navstevy.forEach(function (n) {
      if (!n.milnik_id) return;
      if (!podleMilniku[n.milnik_id]) podleMilniku[n.milnik_id] = [];
      podleMilniku[n.milnik_id].push(n);
    });
    Object.keys(podleMilniku).forEach(function (klic) {
      podleMilniku[klic].sort(function (a, b) {
        return (a.cislo || 0) - (b.cislo || 0);
      });
    });

    // Počet komentářů k milníku (záznamy aktivity s entita "milnik").
    var pocetKomentaru = Object.create(null);
    ziskejPolozky("aktivita").forEach(function (a) {
      if (a.smazano || a.druh !== "komentar" || a.entita !== "milnik" || !a.entita_id) return;
      pocetKomentaru[a.entita_id] = (pocetKomentaru[a.entita_id] || 0) + 1;
    });

    // Konec smlouvy = zahájení + počet měsíců (28 měs. → 26. 12. 2028).
    var mesicu = (nastaveni.rozsah && nastaveni.rozsah.mesicu) ||
      (nastaveni.smlouva && nastaveni.smlouva.mesicu_v_nabidce) || 0;
    var konecSmlouvy = nastaveni.zahajeni && mesicu ? pridejMesice(nastaveni.zahajeni, mesicu) : null;

    return {
      milniky: milniky,
      razene: razene,
      navstevy: navstevy,
      dnes: dnes,
      nastaveni: nastaveni,
      dokument: dokument,
      poTerminu: poTerminu,
      pocetPoTerminu: pocetPoTerminu,
      hotovo: hotovo,
      podleMilniku: podleMilniku,
      pocetKomentaru: pocetKomentaru,
      konecSmlouvy: konecSmlouvy,
      osa: spoctiOsu(razene, nastaveni),
      smiUpravit: muze("plan.upravit")
    };
  }

  // ---------------------------------------------------------------------
  // Vykresleni — HTML retezce, vsechny texty z dat jdou pres esc()
  // ---------------------------------------------------------------------

  function htmlHlava(d) {
    var h = '<header class="nv-hlava"><h2>Plán stavby</h2><div class="nv-hlava-akce">';
    if (d.dokument) {
      h += '<button type="button" class="btn btn-sekundarni btn-mala" data-pl-akce="dokument">Harmonogram PORR</button>';
    }
    if (d.smiUpravit) {
      h += '<button type="button" class="btn btn-primarni btn-mala" data-pl-akce="novy">+ Milník</button>';
    }
    return h + "</div></header>";
  }

  // Stavový štítek: tečka (u hotovo ✓) + slovo; u milníku po termínu k tomu malé
  // oranžové „po termínu“.
  function htmlStav(m, d) {
    return '<span class="pl-stav-obal"><span class="pl-stav pl-stav-' + esc(m.stav) + '">' +
      esc(STAV_MILNIKU[m.stav] || m.stav || "—") + "</span>" +
      (d.poTerminu[m.id] ? '<span class="pl-po-terminu-stitek">po termínu</span>' : "") + "</span>";
  }

  // Popis milníku do tooltipu/aria: název, doslovné datum, stav.
  function popisMilniku(m, d) {
    return m.nazev + " — " + datumMilniku(m) + " · " + (STAV_MILNIKU[m.stav] || m.stav) +
      (d.poTerminu[m.id] ? " (po termínu)" : "");
  }

  // ---- hero „Teď na stavbě“ ----

  function htmlHero(d) {
    var razene = d.razene;
    var i;

    // Co se děje teď: první probíhající, jinak poslední hotový.
    var aktualni = null;
    var jeProbiha = false;
    for (i = 0; i < razene.length; i++) {
      if (razene[i].stav === "probiha") {
        aktualni = razene[i];
        jeProbiha = true;
        break;
      }
    }
    if (!aktualni) {
      for (i = razene.length - 1; i >= 0; i--) {
        if (razene[i].stav === "hotovo") {
          aktualni = razene[i];
          break;
        }
      }
    }

    // Odpočet míří na další milník, který teprve začne.
    var dalsi = null;
    for (i = 0; i < razene.length; i++) {
      if (razene[i].datum_od > d.dnes && razene[i].stav !== "hotovo") {
        dalsi = razene[i];
        break;
      }
    }

    var h = '<section class="pl-hero" aria-label="Teď na stavbě">';
    h += '<div class="pl-hero-stitek">Teď na stavbě</div>';
    h += '<div class="pl-hero-hlava"><div class="pl-hero-text">';
    if (aktualni) {
      h += '<button type="button" class="pl-hero-nazev" data-pl-akce="milnik" data-id="' + esc(aktualni.id) + '">' +
        esc(aktualni.nazev) + "</button>";
      h += '<div class="pl-hero-slovy">' + esc(datumMilniku(aktualni)) +
        (jeProbiha ? "" : '<span class="pl-hero-pozn"> · naposledy dokončeno</span>') + "</div>";
    } else {
      h += '<div class="pl-hero-nazev pl-hero-nic">Zatím nezačal žádný milník</div>';
    }
    h += "</div>";

    if (dalsi) {
      var o = velkyOdpocet(Util.zaDni(dalsi.datum_od));
      h += '<div class="pl-odpocet" title="' + esc(o.popis + " — začátek: " + datumMilniku(dalsi)) + '">' +
        '<div class="pl-odpocet-cislo"><strong>' + esc(o.cislo) + '</strong><span class="pl-odpocet-jednotka">' +
        esc(o.jednotka) + "</span></div>" +
        '<button type="button" class="pl-odpocet-do" data-pl-akce="milnik" data-id="' + esc(dalsi.id) + '">do: ' +
        esc(dalsi.nazev) + "</button></div>";
    }
    h += "</div>";

    // Segmentový ukazatel: jeden segment = jeden milník v chronologickém pořadí.
    h += '<div class="pl-seg" role="group" aria-label="Postup po milnících">';
    razene.forEach(function (m, index) {
      var po = d.poTerminu[m.id];
      var popis = (index + 1) + ". " + popisMilniku(m, d);
      h += '<button type="button" class="pl-seg-dil pl-stav-' + esc(m.stav) + (po ? " pl-po-terminu" : "") +
        '" data-pl-akce="milnik" data-id="' + esc(m.id) + '" title="' + esc(popis) + '" aria-label="' + esc(popis) + '"></button>';
    });
    h += "</div>";

    var radek = "Hotovo " + d.hotovo + " z " + razene.length;
    if (d.nastaveni.predani) {
      radek += " · předání " + Util.formatDatum(d.nastaveni.predani, "presne");
      var za = textZaDlouhy(Util.zaDni(d.nastaveni.predani));
      if (za) radek += " · " + za;
    }
    h += '<p class="pl-hero-radek">' + esc(radek) + "</p>";

    if (d.pocetPoTerminu) {
      var prvni = null;
      for (i = 0; i < razene.length; i++) {
        if (d.poTerminu[razene[i].id]) {
          prvni = razene[i];
          break;
        }
      }
      h += '<div class="pl-varovani" role="status"><span class="pl-varovani-text">⚠ ' + d.pocetPoTerminu + " " +
        tvarCisla(d.pocetPoTerminu, "milník je", "milníky jsou", "milníků je") + " po termínu" +
        (d.smiUpravit ? " — potvrďte stav" : "") + "</span>" +
        (prvni ? '<button type="button" class="btn btn-sekundarni btn-mala" data-pl-akce="milnik" data-id="' + esc(prvni.id) + '">' +
          (d.pocetPoTerminu > 1 ? "Zkontrolovat první" : "Zkontrolovat") + "</button>" : "") + "</div>";
    }

    return h + "</section>";
  }

  // ---- časový pás ----

  function htmlLegenda() {
    return '<ul class="pl-legenda" aria-hidden="true">' +
      '<li><i class="pl-leg pl-stav-hotovo"></i>Hotovo</li>' +
      '<li><i class="pl-leg pl-stav-probiha"></i>Probíhá</li>' +
      '<li><i class="pl-leg pl-stav-planovano"></i>Plánováno</li>' +
      '<li><i class="pl-leg pl-stav-posunuto"></i>Posunuto</li>' +
      '<li><i class="pl-leg pl-po-terminu"></i>Po termínu</li>' +
      '<li><i class="pl-leg pl-leg-nat"></i>Natáčení</li></ul>';
  }

  // Svislý ukazatel přes celou výšku pásu (Dnes / konec smlouvy / předání) se
  // štítkem dole.
  function htmlUkazatel(trida, pozice, nadpis, datum) {
    return '<div class="pl-ukazatel ' + trida + '" style="left:' + pozice + '">' +
      '<span class="pl-ukazatel-stitek"><b>' + esc(nadpis) + "</b><span>" + esc(datum) + "</span></span></div>";
  }

  function htmlPas(d) {
    var osa = d.osa;
    if (!osa) return "";
    var rozsah = osa.konec - osa.od;

    // Pozice v procentech osy (0–100); co je mimo, se přiskřípne ke kraji.
    function pozice(iso) {
      var x = dnyIso(iso);
      if (x === null) return 0;
      return Math.max(0, Math.min(100, ((x - osa.od) / rozsah) * 100));
    }
    function css(cislo) {
      return Math.round(cislo * 100) / 100 + "%";
    }
    // Tooltip kotvíme k okraji, ať dlouhý název nevyčnívá z pásu.
    function kotva(procent) {
      return procent < 25 ? " pl-tip-vlevo" : procent > 65 ? " pl-tip-vpravo" : "";
    }

    var zacatek = isoZDnu(osa.od);
    var konecIso = isoZDnu(osa.konec);
    var rokOd = parseInt(zacatek.slice(0, 4), 10);
    var rokDo = parseInt(konecIso.slice(0, 4), 10);

    var h = '<section class="pl-pas-karta" aria-label="Časový pás stavby">';
    h += '<div class="pl-pas-hlava"><h3 class="pl-nadpis">Časový pás</h3>' + htmlLegenda() + "</div>";
    h += '<div class="pl-pas-scroll"><div class="pl-pas" role="group" aria-label="Časový pás: milníky stavby a naše natáčení">';
    h += '<span class="pl-rada-popisek pl-rada-stavba">Stavba</span>';
    h += '<span class="pl-rada-popisek pl-rada-natoceni">Natáčení</span>';
    h += '<div class="pl-osa">';

    // Přelomy let: jemná svislá linka a letopočet nad osou. První rok začíná
    // na levém kraji (zahájení), další na 1. lednu.
    var r;
    for (r = rokOd; r <= rokDo; r++) {
      h += '<div class="pl-rok" style="left:' + css(r === rokOd ? 0 : pozice(r + "-01-01")) + '">' +
        '<span class="pl-rok-popisek">' + r + "</span></div>";
    }

    // Měsíce: drobné značky na ose (leden má vlastní linku roku).
    var rm = rokOd;
    var mm = parseInt(zacatek.slice(5, 7), 10) + 1;
    for (;;) {
      if (mm > 12) {
        mm = 1;
        rm++;
      }
      var prvniVMesici = dnyIso(rm + "-" + (mm < 10 ? "0" : "") + mm + "-01");
      if (prvniVMesici === null || prvniVMesici >= osa.konec) break;
      if (mm !== 1) {
        h += '<i class="pl-mesic" style="left:' + css(((prvniVMesici - osa.od) / rozsah) * 100) + '"></i>';
      }
      mm++;
    }

    // Osa a uplynulá část (od zahájení po dnešek).
    h += '<div class="pl-osa-linka"></div>';
    h += '<div class="pl-osa-uplynulo" style="width:' + css(pozice(d.dnes)) + '"></div>';

    // Ukazatele: Dnes, konec smlouvy, předání. Dnes jen když leží na ose.
    var dnesDny = dnyIso(d.dnes);
    if (dnesDny !== null && dnesDny >= osa.od && dnesDny <= osa.konec) {
      h += htmlUkazatel("pl-ukazatel-dnes", css(pozice(d.dnes)), "Dnes", Util.formatDatum(d.dnes, "presne"));
    }
    if (d.konecSmlouvy) {
      h += htmlUkazatel("pl-ukazatel-smlouva", css(pozice(d.konecSmlouvy)), "konec smlouvy",
        Util.formatDatum(d.konecSmlouvy, "presne"));
    }
    if (d.nastaveni.predani) {
      h += htmlUkazatel("pl-ukazatel-predani", css(pozice(d.nastaveni.predani)), "předání",
        Util.formatDatum(d.nastaveni.predani, "presne"));
    }

    // Úseky milníků, které trvají déle než den (měsíc, období).
    d.razene.forEach(function (m) {
      var a = dnyIso(m.datum_od);
      var b = dnyIso(m.datum_do);
      if (a === null || b === null || b <= a) return;
      var zleva = pozice(m.datum_od);
      h += '<i class="pl-usek pl-stav-' + esc(m.stav) + (d.poTerminu[m.id] ? " pl-po-terminu" : "") +
        '" style="left:' + css(zleva) + ";width:" + css(pozice(m.datum_do) - zleva) + '"></i>';
    });

    // Tečky milníků. Pozdější se kreslí přes dřívější — blízké tečky se tak
    // čtou jako řetízek, ne jako jedna kaňka.
    d.razene.forEach(function (m) {
      var procent = pozice(m.datum_od);
      var po = d.poTerminu[m.id];
      h += '<button type="button" class="pl-znacka pl-bod pl-stav-' + esc(m.stav) + (po ? " pl-po-terminu" : "") +
        kotva(procent) + '" style="left:' + css(procent) + '" data-pl-akce="milnik" data-id="' + esc(m.id) +
        '" data-tip="' + esc(m.nazev + "\n" + datumMilniku(m) + " · " + (STAV_MILNIKU[m.stav] || m.stav) + (po ? " · po termínu" : "")) +
        '" aria-label="' + esc("Milník: " + popisMilniku(m, d)) + '"></button>';
    });

    // Značky našich natáčení pod osou (zrušené vynecháváme). Dvě blízké se
    // rozloží do dvou řádků, ať se nepřekrývají a dá se do nich kliknout.
    var natoceni = d.navstevy
      .filter(function (n) {
        return n.datum && n.stav !== "zruseno";
      })
      .sort(function (a, b) {
        if (a.datum < b.datum) return -1;
        if (a.datum > b.datum) return 1;
        return (a.cislo || 0) - (b.cislo || 0);
      });
    var posledniVRade = [-100, -100];
    natoceni.forEach(function (n) {
      var procent = pozice(n.datum);
      var vzdal0 = procent - posledniVRade[0];
      var vzdal1 = procent - posledniVRade[1];
      var rada = vzdal0 >= MIN_ODSTUP_NATOCENI ? 0 : vzdal1 >= MIN_ODSTUP_NATOCENI ? 1 : (vzdal0 >= vzdal1 ? 0 : 1);
      posledniVRade[rada] = procent;
      var termin = Util.formatDatum(n.datum, n.datum_presnost || "presne", n.datum_do);
      var presne = (n.datum_presnost || "presne") === "presne";
      var popis = "Natáčení #" + n.cislo + " — " + n.nazev + " · " + termin + " · " + (STAV_NAVSTEVY[n.stav] || n.stav);
      h += '<button type="button" class="pl-znacka pl-nat pl-nat-' + esc(n.stav) + (presne ? "" : " pl-nat-orient") +
        " pl-nat-rada-" + rada + kotva(procent) + '" style="left:' + css(procent) +
        '" data-pl-akce="navsteva" data-id="' + esc(n.id) + '" data-tip="' +
        esc("Natáčení #" + n.cislo + " · " + n.nazev + "\n" + termin + " · " + (STAV_NAVSTEVY[n.stav] || n.stav)) +
        '" aria-label="' + esc(popis) + '"></button>';
    });

    h += "</div></div></div></section>";
    return h;
  }

  // ---- tabulka milníků ----

  // Měsíc v rámečku jako lísteček z kalendáře: přesné datum = plný rámeček
  // s dnem, orientační termín (měsíc, období) = čárkovaný rámeček jen s měsícem.
  function htmlDlazdice(m) {
    var p = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(m.datum_od || ""));
    var titulek = esc(datumMilniku(m));
    if (!p) {
      return '<span class="nv-dlazdice nv-dlazdice-orientacni" title="datum neurčeno">' +
        '<span class="nv-dlazdice-mesic">—</span></span>';
    }
    var mesic = MESICE_ZKR[parseInt(p[2], 10) - 1] || "—";
    if (m.presnost !== "presne") {
      return '<span class="nv-dlazdice nv-dlazdice-orientacni" title="' + titulek + '">' +
        '<span class="nv-dlazdice-mesic">' + esc(mesic) + "</span></span>";
    }
    return '<span class="nv-dlazdice" title="' + titulek + '">' +
      '<span class="nv-dlazdice-mesic">' + esc(mesic) + "</span>" +
      '<span class="nv-dlazdice-den">' + parseInt(p[3], 10) + "</span></span>";
  }

  // Čipy navázaných návštěv („#4“ s tečkou barvy stavu). Odkaz vede rovnou na
  // detail návštěvy; klik na čip nesmí otevřít detail milníku (viz posluchač).
  function htmlCipy(m, d) {
    var nav = d.podleMilniku[m.id] || [];
    if (!nav.length) return '<span class="pl-cipy pl-cipy-prazdne"><span aria-hidden="true">—</span></span>';
    var h = '<span class="pl-cipy">';
    nav.forEach(function (n) {
      h += '<a class="pl-cip pl-cip-' + esc(n.stav) + '" href="#navstevy/' + esc(encodeURIComponent(n.id)) +
        '" title="' + esc("Natáčení #" + n.cislo + " — " + n.nazev + " (" + (STAV_NAVSTEVY[n.stav] || n.stav) + ")") +
        '"><i class="pl-cip-bod" aria-hidden="true"></i>#' + esc(n.cislo) + "</a>";
    });
    return h + "</span>";
  }

  // Řádek tabulky: lísteček | název + datum slovy | (natáčení, kdy, stav).
  // Druhá část je v obalu .nv-radek-meta — na počítači se rozpadne do sloupců
  // tabulky (display: contents), na mobilu z něj je druhý řádek pod názvem.
  function htmlRadek(m, d) {
    var po = d.poTerminu[m.id];
    var komentaru = d.pocetKomentaru[m.id] || 0;
    var h = '<li class="nv-radek pl-radek pl-stav-' + esc(m.stav) + (po ? " pl-po-terminu" : "") +
      '" data-id="' + esc(m.id) + '" tabindex="0" role="button" aria-label="' +
      esc("Otevřít milník: " + popisMilniku(m, d)) + '">';
    h += htmlDlazdice(m);
    h += '<span class="nv-radek-nazev"><span class="pl-nazev-radek"><span class="pl-nazev-text">' + esc(m.nazev) + "</span>" +
      (komentaru > 0 ? '<span class="nv-bublina" title="Komentáře">' + komentaru + "</span>" : "") + "</span>" +
      '<span class="pl-slovy">' + esc(datumMilniku(m)) + "</span></span>";
    h += '<span class="nv-radek-meta">' + htmlCipy(m, d) +
      '<span class="nv-za">' + esc(textZa(m, d.dnes)) + "</span>" + htmlStav(m, d) + "</span>";
    return h + "</li>";
  }

  // Tenká zelená linka přes celou šířku tabulky se štítkem — odděluje
  // minulost od budoucnosti. Není klikací.
  function htmlDnes(d) {
    return '<li class="pl-dnes" aria-label="Dnes"><span class="pl-dnes-stitek">Dnes · ' +
      esc(Util.formatDatum(d.dnes, "presne")) + "</span></li>";
  }

  function htmlTabulka(d) {
    var razene = d.razene;
    var h = '<section class="nv-plan pl-plan" aria-label="Milníky stavby"><div class="nv-tabulka pl-tabulka">' +
      '<div class="nv-tabulka-hlava" aria-hidden="true"><span>Termín</span><span>Milník</span>' +
      "<span>Natáčení</span><span>Kdy</span><span>Stav</span></div>";

    // Index prvního milníku, který teprve začne — před něj patří řádek „Dnes“.
    var idxDnes = razene.length;
    var i;
    for (i = 0; i < razene.length; i++) {
      if (razene[i].datum_od > d.dnes) {
        idxDnes = i;
        break;
      }
    }

    // Skupiny po letech (řazeno podle začátku, takže jsou souvislé).
    var skupiny = [];
    var mapa = Object.create(null);
    razene.forEach(function (m, index) {
      var rok = String(m.datum_od || m.rok || "").slice(0, 4) || "bez";
      var s = mapa[rok];
      if (!s) {
        s = mapa[rok] = { rok: rok, od: index, konec: index, polozky: [] };
        skupiny.push(s);
      }
      s.konec = index;
      s.polozky.push({ m: m, index: index });
    });

    skupiny.forEach(function (s) {
      h += '<div class="nv-skupina"><h3 class="nv-rok"><span>' + esc(s.rok === "bez" ? "Bez termínu" : s.rok) + "</span>" +
        '<span class="nv-rok-pocet">' + esc(tvarMilniku(s.polozky.length)) + '</span></h3><ol class="nv-seznam">';
      s.polozky.forEach(function (x) {
        // „Dnes“ patří před první budoucí milník; začíná-li tím nový rok, dáme
        // ho radši na konec předchozího roku, ať nevisí pod nadpisem roku,
        // který ještě nezačal (viz konec cyklu níž).
        if (x.index === idxDnes && (x.index !== s.od || x.index === 0)) h += htmlDnes(d);
        h += htmlRadek(x.m, d);
      });
      if (s.konec + 1 === idxDnes) h += htmlDnes(d);
      h += "</ol></div>";
    });

    return h + "</div></section>";
  }

  // ---------------------------------------------------------------------
  // Boční panel — dialog.modal-okno.nv-panel (stejný základ jako v Návštěvách)
  // ---------------------------------------------------------------------

  // `poZavreni` se zavolá právě jednou — hned při zavření křížkem/klikem
  // vedle, nebo z události "close" (Esc). Na samotnou událost "close" se
  // spoléhat nedá: prohlížeč ji posílá až při dalším vykreslení, a v kartě
  // na pozadí tak stav panelu zůstal viset a další panel se neotevřel.
  function otevriDialog(obsahUzel, poZavreni) {
    var dlg = document.createElement("dialog");
    dlg.className = "modal-okno nv-panel";

    var hlavicka = document.createElement("div");
    hlavicka.className = "modal-hlavicka";
    var h = document.createElement("h3");
    h.className = "modal-nadpis";
    var zavriBtn = document.createElement("button");
    zavriBtn.type = "button";
    zavriBtn.className = "modal-zavrit";
    zavriBtn.setAttribute("aria-label", "Zavřít");
    zavriBtn.textContent = "×";
    hlavicka.appendChild(h);
    hlavicka.appendChild(zavriBtn);

    var telo = document.createElement("div");
    telo.className = "modal-telo";
    telo.appendChild(obsahUzel);

    dlg.appendChild(hlavicka);
    dlg.appendChild(telo);
    document.body.appendChild(dlg);

    var hotovo = false;
    function dokonci() {
      if (hotovo) return;
      hotovo = true;
      dlg.remove();
      if (typeof poZavreni === "function") poZavreni();
    }
    function zavri() {
      if (dlg.open) dlg.close();
      dokonci();
    }
    zavriBtn.addEventListener("click", zavri);
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) zavri();
    });
    dlg.addEventListener("close", dokonci);
    dlg.showModal();
    return { dlg: dlg, zavri: zavri };
  }

  // Pomocné pro obnovu panelu po pollingu: kde byl fokus a co se rozepsalo.
  function zapamatujFokus(koren) {
    var a = document.activeElement;
    if (!a || !koren.contains(a)) return null;
    if (a.tagName === "TEXTAREA") return { typ: "textarea", od: a.selectionStart, po: a.selectionEnd };
    if (a.getAttribute && a.getAttribute("data-pl-akce")) {
      return {
        typ: "tlacitko",
        akce: a.getAttribute("data-pl-akce"),
        stav: a.getAttribute("data-stav") || "",
        id: a.getAttribute("data-id") || ""
      };
    }
    return null;
  }

  function obnovFokus(koren, f) {
    if (!f) return;
    var el = null;
    if (f.typ === "textarea") {
      el = formularKomentare ? formularKomentare.textarea : null;
    } else if (f.typ === "tlacitko") {
      var kandidati = koren.querySelectorAll("[data-pl-akce]");
      for (var i = 0; i < kandidati.length; i++) {
        var k = kandidati[i];
        if (k.getAttribute("data-pl-akce") === f.akce && (k.getAttribute("data-stav") || "") === f.stav &&
          (k.getAttribute("data-id") || "") === f.id) {
          el = k;
          break;
        }
      }
    }
    if (!el || typeof el.focus !== "function") return;
    try {
      el.focus({ preventScroll: true });
    } catch (chyba) {
      el.focus();
    }
    if (f.typ === "textarea" && typeof el.setSelectionRange === "function") {
      try {
        el.setSelectionRange(f.od, f.po);
      } catch (chyba2) {
        /* bez výběru se obejdeme */
      }
    }
  }

  function precistKoncept() {
    if (!formularKomentare) return null;
    return {
      text: formularKomentare.textarea.value,
      zminky: formularKomentare.vyber.vybrane()
    };
  }

  // ---- obsah panelu: detail milníku ----

  function htmlPrepinac(m) {
    var h = '<div class="pl-prepinac" role="group" aria-label="Stav milníku">';
    PORADI_STAVU.forEach(function (s) {
      var aktivni = m.stav === s;
      h += '<button type="button" class="pl-prepinac-btn pl-stav-' + s + (aktivni ? " pl-aktivni" : "") +
        '" data-pl-akce="stav" data-stav="' + s + '" aria-pressed="' + (aktivni ? "true" : "false") + '">' +
        esc(STAV_MILNIKU[s]) + "</button>";
    });
    return h + "</div>";
  }

  function htmlPanelNatoceni(m, d) {
    var nav = d.podleMilniku[m.id] || [];
    var h = '<section class="nv-panel-sekce"><h3>Natáčení</h3>';
    if (!nav.length) {
      return h + '<p class="pl-prazdno">K tomuto milníku zatím není navázané žádné natáčení.</p></section>';
    }

    h += '<div class="pl-nat-seznam">';
    nav.forEach(function (n) {
      var termin = n.datum ? Util.formatDatum(n.datum, n.datum_presnost || "presne", n.datum_do) : "termín neurčen";
      var typy = (n.typ || []).map(function (t) {
        return TYP_NAVSTEVY[t] || t;
      }).join(", ");
      h += '<a class="pl-nat-radek pl-cip-' + esc(n.stav) + '" href="#navstevy/' + esc(encodeURIComponent(n.id)) + '">' +
        '<i class="pl-cip-bod" aria-hidden="true"></i>' +
        '<span class="pl-nat-text"><span class="pl-nat-nazev"><span class="nv-cislo">#' + esc(n.cislo) + "</span> " +
        esc(n.nazev) + "</span>" +
        '<span class="pl-nat-meta">' + esc(termin) + (typy ? " · " + esc(typy) : "") + "</span></span>" +
        '<span class="pl-nat-stav">' + esc(STAV_NAVSTEVY[n.stav] || n.stav) + "</span></a>";
    });
    h += "</div>";

    // Co u toho milníku natočíme — bere se ze shot listu navázaných návštěv,
    // aby to bylo na jednom místě s plánem stavby. Není to druhá kopie dat,
    // jen pohled na to samé; edituje se v Návštěvách.
    var zabery = [];
    nav.forEach(function (n) {
      if (n.stav === "zruseno") return;
      (n.co_se_toci || []).forEach(function (z) {
        if (z && z.text) zabery.push(z);
      });
    });
    if (zabery.length) {
      h += '<h4 class="pl-podnadpis">Co natočíme</h4><ul class="pl-zabery">';
      zabery.forEach(function (z) {
        h += '<li class="pl-zaber' + (z.hotovo ? " pl-zaber-hotovy" : "") + '"><span class="pl-zaber-znak" aria-hidden="true">' +
          (z.hotovo ? "✓" : "") + "</span><span>" + esc(z.text) + (z.hotovo ? '<span class="sr-only"> (hotovo)</span>' : "") +
          "</span></li>";
      });
      h += '</ul><p class="karta-meta">Upravuje se v Návštěvách.</p>';
    }
    return h + "</section>";
  }

  function htmlPanelMilniku(m, d) {
    var po = d.poTerminu[m.id];
    var za = textZa(m, d.dnes);

    var h = '<section class="nv-panel-sekce pl-panel-uvod">';
    if (panelOdDokumentu && d.dokument) {
      h += '<button type="button" class="btn btn-tiche btn-mala pl-zpet" data-pl-akce="dokument">← Harmonogram PORR</button>';
    }
    h += '<div class="pl-panel-datum">' + esc(datumMilniku(m)) + "</div>";
    h += '<div class="pl-panel-meta">' + (za ? '<span class="nv-za">' + esc(za) + "</span>" : "") + htmlStav(m, d) + "</div>";
    if (po) {
      h += '<p class="pl-panel-varovani">⚠ Termín už uplynul' +
        (d.smiUpravit ? " — potvrďte, jestli je hotovo, nebo ho posuňte." : ".") + "</p>";
    }
    if (d.smiUpravit) h += htmlPrepinac(m);
    h += "</section>";

    if (m.popis) {
      h += '<section class="nv-panel-sekce"><h3>Popis</h3><p class="pl-text">' + esc(m.popis) + "</p></section>";
    }

    // Doslovné znění řádku z harmonogramu PORR — ať je vždycky vidět, co přesně
    // poslali, a nedá se to splést s naší interpretací.
    if (m.zdroj_text || m.zdroj) {
      h += '<section class="nv-panel-sekce"><h3>' + (m.zdroj_text ? "Z harmonogramu PORR" : "Zdroj") + "</h3>";
      if (m.zdroj_text) h += '<blockquote class="citace-zdroje">' + esc(m.zdroj_text) + "</blockquote>";
      if (m.zdroj) h += '<p class="karta-meta">Zdroj: ' + esc(m.zdroj) + "</p>";
      h += "</section>";
    }

    if (m.poznamka) {
      h += '<section class="nv-panel-sekce"><h3>Poznámka</h3><p class="pl-text">' + esc(m.poznamka) + "</p></section>";
    }

    h += htmlPanelNatoceni(m, d);

    // Komentáře jsou živé DOM prvky (formulář, výběr lidí) — vloží se na místo.
    h += '<section class="nv-panel-sekce pl-sekce-komentare"><div data-pl-komentare></div></section>';

    if (d.smiUpravit) {
      h += '<section class="nv-panel-sekce"><div class="nv-panel-akce pl-panel-akce">' +
        '<button type="button" class="btn btn-sekundarni btn-mala" data-pl-akce="upravit">Upravit podrobnosti</button>' +
        '<button type="button" class="btn btn-tiche btn-mala" data-pl-akce="smazat">Smazat</button></div></section>';
    }
    return h;
  }

  // ---- obsah panelu: původní harmonogram od PORR ----

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

  function htmlRadekDokumentu(radek, index, milniky) {
    var druh = druhRadkuDokumentu(radek, index);

    if (druh === "nadpis") return '<p class="harmonogram-nazev">' + esc(radek) + "</p>";
    if (druh === "rok") return '<h4 class="harmonogram-rok">' + esc(radek) + "</h4>";

    var shody = najdiMilnikyProRadek(radek, milniky);
    if (!shody.length) {
      // Radek, ke kteremu nas milnik neni (nebo ma jinak psany zdroj_text) —
      // zustava jen jako text, at se necenzuruje a nepredstira proklik.
      return '<p class="harmonogram-radek">' + esc(radek) + "</p>";
    }

    var titulek = shody.length > 1
      ? "Otevřít milník: " + shody[0].nazev + " (v plánu je k tomuto řádku " + shody.length + " milníky)"
      : "Otevřít milník: " + shody[0].nazev;
    return '<button type="button" class="harmonogram-radek harmonogram-radek-klikaci" data-pl-akce="milnik-z-dokumentu" ' +
      'data-id="' + esc(shody[0].id) + '" title="' + esc(titulek) + '">' + esc(radek) + "</button>";
  }

  function htmlPanelDokumentu(d) {
    var dokument = d.dokument;
    if (!dokument) {
      return '<section class="nv-panel-sekce"><p class="pl-prazdno">Původní harmonogram není k dispozici.</p></section>';
    }
    var h = '<section class="nv-panel-sekce">';
    h += '<p class="karta-meta">Takhle nám harmonogram přišel. Náš plán z něj vychází, jen je seřazený chronologicky ' +
      "a doplněný o naše návštěvy. Řádek s šipkou otevře příslušný milník.</p>";
    h += '<div class="harmonogram-radky">';
    dokument.radky.forEach(function (radek, index) {
      h += htmlRadekDokumentu(radek, index, d.milniky);
    });
    h += "</div>";
    // "od Lucie Obdržálkové" je 2. pád — v datech je jmeno v 1. pádu i s
    // oddelenim (App.obsah("harmonogram").od), to jde do tooltipu.
    h += '<p class="harmonogram-zdroj"' + (dokument.od ? ' title="' + esc("Od: " + dokument.od) + '"' : "") + ">" +
      esc("Zdroj: " + dokument.soubor + ", od Lucie Obdržálkové, " + Util.formatDatum(dokument.ziskano, "presne")) + "</p>";
    return h + "</section>";
  }

  // ---- otevření a obnova panelu ----

  // Vykreslí obsah panelu podle režimu. `zNova` = nový obsah (odroluje nahoru,
  // zapomene fokus a koncept); jinak jde o obnovu po změně dat a zachová se
  // pozice rolování, fokus i rozepsaný komentář.
  function vykresliPanel(zNova, dataParam) {
    if (!panel) return;
    var d = dataParam || pripravData();
    var telo = panel.dlg.querySelector(".modal-telo");
    var nadpisEl = panel.dlg.querySelector(".modal-nadpis");
    var scroll = zNova || !telo ? 0 : telo.scrollTop;
    var fokus = zNova ? null : zapamatujFokus(panel.obsah);
    var koncept = zNova ? null : precistKoncept();
    formularKomentare = null;

    if (panelRezim === "dokument") {
      nadpisEl.textContent = "Harmonogram PORR";
      panel.obsah.innerHTML = htmlPanelDokumentu(d);
    } else {
      var m = najdiMilnik(panelMilnikId);
      if (!m) {
        // Milník mezitím zmizel (smazán v koši) — panel nemá co ukazovat.
        panel.zavri();
        return;
      }
      nadpisEl.textContent = m.nazev;
      panel.obsah.innerHTML = htmlPanelMilniku(m, d);
      var misto = panel.obsah.querySelector("[data-pl-komentare]");
      if (misto) misto.appendChild(vytvorKomentare(m.id, koncept));
    }

    if (telo) telo.scrollTop = scroll;
    obnovFokus(panel.obsah, fokus);
  }

  function otevriPanel(rezim, id, odDokumentu) {
    panelRezim = rezim;
    panelMilnikId = rezim === "milnik" ? id : null;
    panelOdDokumentu = rezim === "milnik" && !!odDokumentu;
    // Komentáře jsou v panelu hned rozbalené (Franta chce vidět, co se řeklo).
    if (rezim === "milnik") otevreneKomentare[id] = true;

    if (!panel) {
      var obsah = document.createElement("div");
      obsah.className = "pl-panel";
      napojPosluchacePanelu(obsah);
      panel = otevriDialog(obsah, function () {
        panel = null;
        panelRezim = null;
        panelMilnikId = null;
        panelOdDokumentu = false;
        formularKomentare = null;
      });
      panel.obsah = obsah;
    }
    vykresliPanel(true);
  }

  // ---------------------------------------------------------------------
  // Posluchače
  // ---------------------------------------------------------------------

  // Posluchače v panelu — panel.obsah žije, dokud je dialog otevřený, jen se
  // mění jeho děti, takže stačí jednou při vytvoření.
  function napojPosluchacePanelu(obsah) {
    obsah.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      // Odkaz na detail návštěvy: panel se zavře, hash se změní sám.
      if (t.closest("a[href^='#navstevy']")) {
        if (panel) panel.zavri();
        return;
      }

      var prvek = t.closest("[data-pl-akce]");
      if (!prvek) return;
      var akce = prvek.getAttribute("data-pl-akce");

      if (akce === "stav") {
        zmenStav(panelMilnikId, prvek.getAttribute("data-stav"));
      } else if (akce === "upravit") {
        var m = najdiMilnik(panelMilnikId);
        if (m) otevriFormularMilniku(m);
      } else if (akce === "smazat") {
        var k = najdiMilnik(panelMilnikId);
        if (k) smazatMilnik(k);
      } else if (akce === "milnik-z-dokumentu") {
        otevriPanel("milnik", prvek.getAttribute("data-id"), true);
      } else if (akce === "dokument") {
        otevriPanel("dokument");
      }
    });
  }

  // Posluchače na kontejneru sekce — věší se jen jednou (kontejner se mezi
  // vykresleními nemění, mění se jen jeho obsah).
  function napojPosluchace(cil) {
    if (cil._planNapojeno) return;
    cil._planNapojeno = true;

    cil.addEventListener("click", function (e) {
      if (cil.dataset.aktivniSekce !== "plan") return;
      var t = e.target;
      if (!t || !t.closest || !t.closest(".pl")) return;

      // Čip návštěvy (odkaz na #navstevy/<id>) nechá prohlížeč navigovat a
      // detail milníku neotevírá.
      if (t.closest("a")) return;

      var prvek = t.closest("[data-pl-akce]");
      if (prvek) {
        var akce = prvek.getAttribute("data-pl-akce");
        if (akce === "milnik") {
          otevriPanel("milnik", prvek.getAttribute("data-id"));
        } else if (akce === "dokument") {
          otevriPanel("dokument");
        } else if (akce === "novy") {
          otevriFormularMilniku(null);
        } else if (akce === "navsteva") {
          window.location.hash = "#navstevy/" + encodeURIComponent(prvek.getAttribute("data-id"));
        }
        return;
      }

      // Klik kamkoli do řádku tabulky = detail milníku.
      var radek = t.closest(".pl-radek");
      if (radek && radek.getAttribute("data-id")) otevriPanel("milnik", radek.getAttribute("data-id"));
    });

    // Enter / mezerník na řádku tabulky = otevřít detail (řádek je role="button").
    cil.addEventListener("keydown", function (e) {
      if (cil.dataset.aktivniSekce !== "plan") return;
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      var radek = e.target;
      if (!radek || !radek.classList || !radek.classList.contains("pl-radek")) return;
      e.preventDefault();
      var id = radek.getAttribute("data-id");
      if (id) otevriPanel("milnik", id);
    });

    // Pozice rolování pásu: scroll nebublá, proto zachytávání.
    cil.addEventListener("scroll", function (e) {
      if (cil.dataset.aktivniSekce !== "plan") return;
      var t = e.target;
      if (t && t.classList && t.classList.contains("pl-pas-scroll")) pasScrollLeft = t.scrollLeft;
    }, true);
  }

  // Panel patří sekci Plán. Odejde-li člověk jinam (zpět v prohlížeči, odkaz
  // na návštěvu), zavřeme ho, ať nevisí nad cizí sekcí.
  window.addEventListener("hashchange", function () {
    if (!panel) return;
    var sekce = (window.location.hash || "").replace("#", "").split("/")[0];
    if (sekce !== "plan") panel.zavri();
  });

  // ---------------------------------------------------------------------
  // Vykresleni sekce
  // ---------------------------------------------------------------------

  // Po prvním vykreslení odroluje pás tak, aby byl „Dnes“ vidět (na počítači
  // se pás vejde celý a nic se neděje). Při dalších překresleních se vrací
  // pozice, kterou si člověk nastavil sám.
  function nastavRolovaniPasu(cil) {
    var pas = cil.querySelector(".pl-pas-scroll");
    if (!pas) return;
    if (pas.scrollWidth <= pas.clientWidth) return;
    if (pasScrollLeft !== null) {
      pas.scrollLeft = pasScrollLeft;
      return;
    }
    var dnesEl = pas.querySelector(".pl-ukazatel-dnes");
    if (!dnesEl) return;
    var x = dnesEl.getBoundingClientRect().left - pas.getBoundingClientRect().left + pas.scrollLeft;
    pas.scrollLeft = Math.max(0, x - 96);
  }

  function vykresli(kontejnerParam) {
    var cil = kontejnerParam || document.getElementById("obsah");
    if (!cil) return;

    // Přišli jsme z jiné sekce → rolování pásu začíná znovu u „Dnes“.
    if (cil.dataset.aktivniSekce !== "plan") pasScrollLeft = null;
    cil.dataset.aktivniSekce = "plan";

    var d = pripravData();

    var h = '<div class="nv pl">' + htmlHlava(d);
    if (!d.milniky.length) {
      h += '<div class="prazdny-stav"><div class="prazdny-stav-ikona"></div>' +
        '<p class="prazdny-stav-text">Zatím nejsou zavedené žádné milníky.</p></div>';
    } else {
      h += htmlHero(d) + htmlPas(d) + htmlTabulka(d);
    }
    h += "</div>";

    cil.innerHTML = h;
    napojPosluchace(cil);
    nastavRolovaniPasu(cil);

    // Otevřený panel se nezavírá — jen se mu obnoví obsah z nových dat.
    if (panel) vykresliPanel(false, d);
  }

  App.registrujSekci("plan", vykresli);
})();
