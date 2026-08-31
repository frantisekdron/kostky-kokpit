/*
 * view-navstevy.js — sekce "Návštěvy" (KONTRAKT.md §9.2 a celý §6 — schvalovací
 * kolečko natáčecích návštěv).
 *
 * Seznam našich natáčecích návštěv na stavbě, seskupený po letech
 * (2026 / 2027 / 2028 / 2029, bezdatumové na konci), s přepínačem
 * Vše | Čeká na schválení | Nadcházející | Proběhlé (u každého počet).
 *
 * KARTA má nahoře JEDEN zřetelný stavový řádek: velká barevná kontrolka
 * (kroužek s tvarem — ○ ◐ ◆ ● ✓ ✕, aby se stavy poznaly i bez barvy),
 * termín, čas a název stavu. Barvy dle KONTRAKT.md §8:
 *   navrh šedá · ke-schvaleni oranžová · schvaleno modrá · potvrzeno zelená ·
 *   probehlo tmavě zelená · zruseno červená (termín přeškrtnutý).
 * U stavů navrh/ke-schvaleni/schvaleno a u měsíčních/obdobních termínů se
 * připisuje drobné "orientačně".
 *
 * RYCHLÁ EDITACE PŘÍMO NA KARTĚ (jen s právem navstevy.upravit):
 *   - klik na termín rozbalí inline pole datum + přesnost (přesně/měsíc/období,
 *     u období i "do") a čas od–do; každá změna se ukládá HNED (GH.zmen),
 *   - posun ve schvalovacím kolečku jedním tlačítkem (§6), včetně vrácení do
 *     "navrh" s povinnou poznámkou min. 3 znaky (smí jen navstevy.schvalit),
 *   - shot list se zaškrtáváním v rozbalovacím <details>, ať karta není dlouhá.
 * Modál (plná editace) zůstává pro zbytek polí — název, milník, typy, čerpání,
 * obsazení, poznámka — plus shot list s přidáním/mazáním, komentáře a
 * nebezpečnou zónu (zrušit návštěvu / do koše). Termín a čas se v modálu už
 * needitují (jsou na kartě), jen se vypisují.
 *
 * Schvalovací kolečko přesně dle §6:
 *   navrh -> ke-schvaleni -> schvaleno -> potvrzeno -> probehlo
 *   ke-schvaleni -> navrh (vrácení, poznámka min. 3 znaky, uloží se i jako
 *   komentář); kterýkoli stav -> zruseno.
 * Při přechodu do "schvaleno" se zapíše schvaleni.kdo (Auth.ja.osoba_id)
 * a schvaleni.kdy.
 *
 * Hromadná akce "Odeslat celý návrh ke schválení" přepne všechny položky ve
 * stavu navrh na ke-schvaleni jedním voláním GH.zmen (jeden commit).
 * "Kopírovat plán jako text" vygeneruje čitelný seznam všech návštěv do
 * schránky. Mazání je soft delete (smazano:{kdy,kdo}). Čtenáři (bez
 * navstevy.upravit apod.) se editační prvky nezobrazují vůbec — vidí jen
 * text a tlačítko Detail.
 *
 * Návštěvy, které mají v poznámce zmínku o sekci Časosběr, dostanou pod
 * kartou odkaz "→ Časosběr" na #casosber (dodatek §A).
 *
 * Čte App.polozky(soubor)/App.obsah(soubor) — App.data drží VŽDY celou
 * obálku souboru, nikdy se nesahá na App.data[soubor] přímo (viz hlavičkový
 * komentář js/app.js). Po každém zápisu (GH.zmen) uloží celou vrácenou
 * obálku pomocí App.uloz(soubor, obsah).
 *
 * Komentář může někoho OZNAČIT — pole `zminky` (pole os-id) v záznamu
 * aktivity. Označenému má po zápisu přijít upozornění na mail; rozesílá
 * ho GitHub Action nad datovým repem, appka mail odeslat neumí. Výběr lidí
 * staví společná Util.vyberZminek(), řádek pod komentářem Util.radekZminek().
 * Starší komentáře pole nemají — chybějící se bere jako prázdné (Util.zminky).
 *
 * Nevystavuje žádný nový globální objekt — jen se při načtení stránky
 * zaregistruje jako sekce "navstevy" přes App.registrujSekci(). Všechna
 * vlastní pomocná jména jsou schovaná uvnitř IIFE.
 */

(function () {
  "use strict";

  var esc = Util.esc;

  // Jediný zdroj pravdy o stavech návštěvy: název do UI i do textového
  // exportu, znak kontrolky (tvar — kvůli barvosleposti) a jestli se
  // k termínu připisuje "orientačně".
  var STAV_INFO = {
    navrh: { nazev: "Návrh", znak: "○", orientacne: true },
    "ke-schvaleni": { nazev: "Čeká na schválení", znak: "◐", orientacne: true },
    schvaleno: { nazev: "Schváleno", znak: "◆", orientacne: true },
    potvrzeno: { nazev: "Termín potvrzen", znak: "●", orientacne: false },
    probehlo: { nazev: "Proběhlo", znak: "✓", orientacne: false },
    zruseno: { nazev: "Zrušeno", znak: "✕", orientacne: false }
  };

  function stavInfo(stav) {
    return STAV_INFO[stav] || { nazev: String(stav || "—"), znak: "•", orientacne: false };
  }

  function stavNazev(stav) {
    return stavInfo(stav).nazev;
  }

  var TYP_LABEL = {
    foto: "Foto",
    dron: "Dron",
    rucni: "Ruční",
    "casosber-servis": "Časosběr",
    rozhovor: "Rozhovor"
  };
  var TYP_PORADI = ["foto", "dron", "rucni", "casosber-servis", "rozhovor"];

  var PRESNOSTI = [["presne", "přesně"], ["mesic", "měsíc"], ["obdobi", "období"]];

  var STRANY = [
    ["PORR", "PORR"],
    ["Metrostav", "Metrostav"],
    ["FD", "František Dron (náš tým)"]
  ];

  var posledniKontejner = null;
  var filtrAktualni = "vse";

  // Rozbalený inline panel na kartě — vždy nejvýš jeden ({id, druh}),
  // druh: "termin" | "vraceni". Drží se v modulu, aby přežil překreslení
  // po uložení (GH.zmen -> vykresli()).
  var panelOtevreny = null;
  // Rozbalené shot listy na kartách (id -> true).
  var shotOtevrene = Object.create(null);
  // Selektor prvku, na který se má po překreslení vrátit fokus.
  var fokusPo = null;

  var idOtevrenehoDetailu = null;
  var modalObsahUzel = null;
  var modalRef = null;

  // ---- čtení sdílené mezipaměti App.data — App.data[soubor] drží VŽDY
  // celou obálku {verze,...,polozky|data}, čte se přes společné App.polozky()/
  // App.obsah() z js/app.js (tenké obaly, ať zůstanou krátká jména níže) ----

  function polozkyZeSouboru(soubor) {
    return App.polozky(soubor);
  }

  function objektZeSouboru(soubor) {
    return App.obsah(soubor);
  }

  function najdiPodleId(pole, id) {
    if (!pole || !id) return null;
    for (var i = 0; i < pole.length; i++) {
      if (pole[i].id === id) return pole[i];
    }
    return null;
  }

  // ---- drobné pomocné funkce ----

  function dnesniIso() {
    var d = new Date();
    function dv(n) { return n < 10 ? "0" + n : "" + n; }
    return d.getFullYear() + "-" + dv(d.getMonth() + 1) + "-" + dv(d.getDate());
  }

  function popisOsoby(o) {
    if (!o) return "";
    return o.telefon ? o.jmeno + " (" + o.telefon + ")" : o.jmeno;
  }

  // Datum návštěvy VŽDY přes Util.formatDatum s přesností z položky (chybí-li,
  // bere se "presne"); u přesnosti "obdobi" se předává i datum_do jako druhý
  // konec rozsahu (Util.formatDatum si s chybějící hodnotou poradí a vypíše
  // jen jeden měsíc). Sjednoceno napříč appkou — nález auditu
  // O1-sjednoceni-appdata.
  function formatDatumNavstevy(n) {
    if (!n || !n.datum) return "";
    return Util.formatDatum(n.datum, n.datum_presnost || "presne", n.datum_do || null);
  }

  function formatCasRozsah(n) {
    if (n.cas_od && n.cas_do) return n.cas_od + "–" + n.cas_do;
    if (n.cas_od) return "od " + n.cas_od;
    if (n.cas_do) return "do " + n.cas_do;
    return "";
  }

  function seznamOsobPodleId(ids, lide) {
    if (!ids || !ids.length) return "—";
    var jmena = [];
    for (var i = 0; i < ids.length; i++) {
      var o = najdiPodleId(lide, ids[i]);
      if (o) jmena.push(popisOsoby(o));
    }
    return jmena.length ? jmena.join(", ") : "—";
  }

  // Jen jména bez telefonů — na kartu, kde jde o rychlý přehled.
  function jmenaOsobPodleId(ids, lide) {
    if (!ids || !ids.length) return "—";
    var jmena = [];
    for (var i = 0; i < ids.length; i++) {
      var o = najdiPodleId(lide, ids[i]);
      if (o) jmena.push(o.jmeno);
    }
    return jmena.length ? jmena.join(", ") : "—";
  }

  // Nález auditu: prázdné "za_stavbu" se dřív vypisovalo jako holá pomlčka —
  // to je u návštěv navrh/ke-schvaleni/schvaleno v pořádku (osazení se
  // domlouvá až s termínem), ale u potvrzeno/probehlo jde o chybějící údaj,
  // proto se tam navíc zvýrazní štítkem. Vrací už bezpečný HTML fragment
  // (jméno je esc()-nuté, zbytek je statický text) — vkládat přímo, needs
  // no double-escape.
  function htmlZaStavbu(n, lide, jenJmena) {
    var vybrani = n.za_stavbu || [];
    if (vybrani.length) {
      return esc(jenJmena ? jmenaOsobPodleId(vybrani, lide) : seznamOsobPodleId(vybrani, lide));
    }
    var text = esc("zatím nikdo — doplní se při potvrzení termínu");
    if (n.stav === "potvrzeno" || n.stav === "probehlo") {
      return text + ' <span class="stitek" style="--stav-barva:var(--chyba)">chybí</span>';
    }
    return text;
  }

  function jmenoAutora(kdoLoginId, lide) {
    if (!kdoLoginId) return "neznámý";
    var osoba = lide.filter(function (o) { return o.ma_pristup === kdoLoginId; })[0];
    if (osoba) return osoba.jmeno;
    if (window.KONFIG && Array.isArray(KONFIG.osoby)) {
      for (var i = 0; i < KONFIG.osoby.length; i++) {
        if (KONFIG.osoby[i].id === kdoLoginId) return KONFIG.osoby[i].jmeno || kdoLoginId;
      }
    }
    return kdoLoginId;
  }

  function typChipy(typy) {
    return (typy || []).map(function (t) {
      return '<span class="stitek stitek-typ">' + esc(TYP_LABEL[t] || t) + "</span>";
    }).join(" ");
  }

  function cisloNavstevy(id) {
    var n = najdiPodleId(polozkyZeSouboru("navstevy"), id);
    return n ? n.cislo : "";
  }

  // Zmínka o sekci Časosběr v poznámce -> pod kartou odkaz "→ Časosběr".
  // Porovnává se bez diakritiky a bez ohledu na velikost písmen, ať to
  // chytne "Časosběr", "casosber" i "časosběrných kamer".
  function zminujeCasosber(text) {
    if (!text) return false;
    var normalizovane = String(text).toLowerCase();
    if (typeof normalizovane.normalize === "function") {
      normalizovane = normalizovane.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }
    return normalizovane.indexOf("casosber") !== -1;
  }

  function jeOtevrenyPanel(id, druh) {
    return !!(panelOtevreny && panelOtevreny.id === id && panelOtevreny.druh === druh);
  }

  function nastavPanel(id, druh) {
    if (jeOtevrenyPanel(id, druh)) {
      panelOtevreny = null;
    } else {
      panelOtevreny = { id: id, druh: druh };
    }
  }

  // ---- "Kopírovat plán jako text" (§6 kontraktu) ----

  function textCelehoPlanu() {
    var navstevy = polozkyZeSouboru("navstevy")
      .filter(function (n) { return !n.smazano; })
      .slice()
      .sort(function (a, b) { return (a.cislo || 0) - (b.cislo || 0); });
    var plan = polozkyZeSouboru("plan");
    var nastaveni = objektZeSouboru("nastaveni");
    var nazevKratky = String((nastaveni && nastaveni.nazev) || "Pragerovy kostky").split(" — ")[0];

    var radky = [nazevKratky + " — plán natáčení", ""];
    navstevy.forEach(function (n) {
      var milnik = n.milnik_id ? najdiPodleId(plan, n.milnik_id) : null;
      var datumText = n.datum ? formatDatumNavstevy(n) : "datum neurčeno";
      radky.push(n.cislo + ". " + n.nazev + " — " + datumText + " [" + stavNazev(n.stav) + "]");
      if (milnik) radky.push("   Milník: " + milnik.nazev);
      var polozky = n.co_se_toci || [];
      if (polozky.length) {
        radky.push("   Co se točí:");
        polozky.forEach(function (p) { radky.push("     • " + p.text); });
      }
      radky.push("");
    });
    return radky.join("\n");
  }

  // ---- seznam / filtr / seskupení po letech ----

  function ziveNavstevy() {
    return polozkyZeSouboru("navstevy").filter(function (n) { return !n.smazano; });
  }

  function projdiFiltrem(vse, klic) {
    if (klic === "ceka") {
      return vse.filter(function (n) { return n.stav === "ke-schvaleni"; });
    }
    if (klic === "nadchazejici") {
      return vse.filter(function (n) { return n.stav !== "probehlo" && n.stav !== "zruseno"; });
    }
    if (klic === "probehle") {
      return vse.filter(function (n) { return n.stav === "probehlo"; });
    }
    return vse;
  }

  // Chronologicky (datum), při shodě podle čísla. Návštěvy bez data jdou
  // na konec — spadnou do skupiny "Bez termínu".
  function porovnejNavstevy(a, b) {
    var da = a.datum || "9999-99-99";
    var db = b.datum || "9999-99-99";
    if (da !== db) return da < db ? -1 : 1;
    return (a.cislo || 0) - (b.cislo || 0);
  }

  function filtrovaneNavstevy() {
    return projdiFiltrem(ziveNavstevy(), filtrAktualni).slice().sort(porovnejNavstevy);
  }

  function skupinyPodleRoku(seznam) {
    var mapa = Object.create(null);
    var klice = [];
    seznam.forEach(function (n) {
      var klic = n.datum && n.datum.length >= 4 ? n.datum.slice(0, 4) : "bez";
      if (!mapa[klic]) {
        mapa[klic] = [];
        klice.push(klic);
      }
      mapa[klic].push(n);
    });
    klice.sort(function (a, b) {
      if (a === "bez") return 1;
      if (b === "bez") return -1;
      return a < b ? -1 : (a > b ? 1 : 0);
    });
    return klice.map(function (k) {
      return { klic: k, nadpis: k === "bez" ? "Bez termínu" : k, polozky: mapa[k] };
    });
  }

  // Nejbližší nadcházející návštěva napříč VŠEMI (nezávisle na filtru) —
  // dostane akcentní rámeček. Bere se první nezrušená a neproběhlá s datem
  // ode dneška dál.
  function idNejblizsiNavstevy() {
    var dnes = dnesniIso();
    var kandidati = ziveNavstevy().filter(function (n) {
      return n.datum && n.datum >= dnes && n.stav !== "probehlo" && n.stav !== "zruseno";
    }).slice().sort(porovnejNavstevy);
    return kandidati.length ? kandidati[0].id : null;
  }

  function htmlFiltry() {
    var vse = ziveNavstevy();
    var FILTRY = [
      { klic: "vse", nazev: "Vše" },
      { klic: "ceka", nazev: "Čeká na schválení" },
      { klic: "nadchazejici", nazev: "Nadcházející" },
      { klic: "probehle", nazev: "Proběhlé" }
    ];
    var html = '<div class="navstevy-filtr" role="tablist" aria-label="Filtr návštěv">';
    FILTRY.forEach(function (f) {
      var aktivni = f.klic === filtrAktualni;
      var pocet = projdiFiltrem(vse, f.klic).length;
      html += '<button type="button" class="btn btn-mala ' + (aktivni ? "btn-primarni" : "btn-sekundarni") +
        '" data-nav-akce="filtr" data-filtr="' + f.klic + '" aria-pressed="' + aktivni + '">' +
        esc(f.nazev) + ' <span class="navstevy-filtr-pocet">(' + pocet + ")</span></button>";
    });
    html += "</div>";
    return html;
  }

  // ---- inline editace termínu přímo na kartě ----

  function htmlInlineTermin(n) {
    var id = esc(n.id);
    var presnost = n.datum_presnost || "presne";
    var html = '<div class="navsteva-inline" data-panel="termin">';
    html += '<div class="navsteva-inline-mrizka">';

    html += '<div class="navsteva-pole"><label for="itd-' + id + '">Datum</label>' +
      '<input id="itd-' + id + '" name="inline-datum" type="date" value="' + esc(n.datum || "") + '"></div>';

    html += '<div class="navsteva-pole"><label for="itp-' + id + '">Přesnost</label>' +
      '<select id="itp-' + id + '" name="inline-presnost">';
    PRESNOSTI.forEach(function (p) {
      html += '<option value="' + p[0] + '"' + (presnost === p[0] ? " selected" : "") + ">" + esc(p[1]) + "</option>";
    });
    html += "</select></div>";

    if (presnost === "obdobi") {
      html += '<div class="navsteva-pole"><label for="itdd-' + id + '">Období do</label>' +
        '<input id="itdd-' + id + '" name="inline-datum-do" type="date" value="' + esc(n.datum_do || "") + '"></div>';
    }

    html += '<div class="navsteva-pole"><label for="itco-' + id + '">Čas od</label>' +
      '<input id="itco-' + id + '" name="inline-cas-od" type="time" value="' + esc(n.cas_od || "") + '"></div>';
    html += '<div class="navsteva-pole"><label for="itcd-' + id + '">Čas do</label>' +
      '<input id="itcd-' + id + '" name="inline-cas-do" type="time" value="' + esc(n.cas_do || "") + '"></div>';

    html += "</div>";
    html += '<p class="navsteva-inline-napoveda">Každá změna se uloží hned.</p>';
    html += '<div class="karta-akce"><button type="button" class="btn btn-mala btn-tiche" ' +
      'data-nav-akce="zavrit-panel">Hotovo</button></div>';
    html += "</div>";
    return html;
  }

  function htmlInlineVraceni(n) {
    var id = esc(n.id);
    var html = '<div class="navsteva-inline" data-panel="vraceni">';
    html += '<div class="navsteva-pole"><label for="ivr-' + id + '">Důvod vrácení (min. 3 znaky)</label>' +
      '<textarea id="ivr-' + id + '" name="inline-vraceni" rows="2"></textarea></div>';
    html += '<div class="navsteva-inline-chyba" hidden></div>';
    html += '<div class="karta-akce">' +
      '<button type="button" class="btn btn-mala btn-primarni" data-nav-akce="potvrdit-vraceni-karta">Potvrdit vrácení</button>' +
      '<button type="button" class="btn btn-mala btn-tiche" data-nav-akce="zavrit-panel">Zrušit</button>' +
      "</div>";
    html += "</div>";
    return html;
  }

  // ---- schvalovací kolečko jedním tlačítkem na kartě (§6) ----

  function htmlKrokyStavu(n, prava) {
    var tlacitka = "";
    if (n.stav === "navrh" && prava.upravit) {
      tlacitka += '<button type="button" class="btn btn-mala btn-primarni" data-nav-akce="stav-odeslat">Odeslat ke schválení</button>';
    }
    if (n.stav === "ke-schvaleni" && prava.schvalit) {
      tlacitka += '<button type="button" class="btn btn-mala btn-primarni" data-nav-akce="stav-schvalit">Schválit</button>';
      tlacitka += '<button type="button" class="btn btn-mala btn-sekundarni" data-nav-akce="stav-vratit" aria-expanded="' +
        (jeOtevrenyPanel(n.id, "vraceni") ? "true" : "false") + '">Vrátit k přepracování</button>';
    }
    if (n.stav === "schvaleno" && prava.upravit) {
      tlacitka += '<button type="button" class="btn btn-mala btn-primarni" data-nav-akce="stav-potvrdit">Potvrdit termín</button>';
    }
    if (n.stav === "potvrzeno" && prava.upravit) {
      tlacitka += '<button type="button" class="btn btn-mala btn-primarni" data-nav-akce="stav-probehlo">Označit jako proběhlo</button>';
    }
    return tlacitka;
  }

  // ---- shot list na kartě (rozbalovací) ----

  function htmlShotNaKarte(n, prava) {
    var polozky = n.co_se_toci || [];
    var hotovo = polozky.filter(function (p) { return p.hotovo; }).length;
    var otevreno = !!shotOtevrene[n.id];

    var html = '<details class="navsteva-shot"' + (otevreno ? " open" : "") + ">";
    html += '<summary class="navsteva-shot-souhrn"><span>Shot list</span>' +
      '<span class="navsteva-shot-pocet">' + hotovo + " / " + polozky.length + "</span></summary>";

    if (!polozky.length) {
      html += '<p class="navsteva-shot-prazdny">Zatím žádné položky — přidají se v detailu.</p>';
    } else {
      html += '<ul class="navsteva-shot-seznam">';
      polozky.forEach(function (p) {
        var hotovoTrida = p.hotovo ? " navsteva-shot-hotovo" : "";
        if (prava.upravit) {
          html += '<li class="navsteva-shot-radek' + hotovoTrida + '">' +
            '<input type="checkbox" name="shot-karta" data-polozka="' + esc(p.id) + '"' +
            (p.hotovo ? " checked" : "") + ' id="sk-' + esc(n.id) + "-" + esc(p.id) + '">' +
            '<label for="sk-' + esc(n.id) + "-" + esc(p.id) + '">' + esc(p.text) + "</label></li>";
        } else {
          html += '<li class="navsteva-shot-radek' + hotovoTrida + '">' +
            '<span class="navsteva-shot-znak" aria-hidden="true">' + (p.hotovo ? "☑" : "☐") + "</span>" +
            "<span>" + esc(p.text) + "</span></li>";
        }
      });
      html += "</ul>";
    }
    html += "</details>";
    return html;
  }

  // ---- karta ----

  function htmlKarta(n, lide, plan, prava, jeNejblizsi) {
    var info = stavInfo(n.stav);
    var presnost = n.datum_presnost || "presne";
    var jeOrientacni = !!n.datum && (info.orientacne || presnost === "mesic" || presnost === "obdobi");
    var milnik = n.milnik_id ? najdiPodleId(plan, n.milnik_id) : null;
    var casText = formatCasRozsah(n);

    // Jemné barevné rozdělení do tří skupin, ať je na první pohled poznat,
    // co je za námi, co je na řadě a co je zatím jen návrh (Franta 30. 8.).
    var skupina = "navrh";                                   // další návrhy
    if (n.stav === "probehlo" || n.stav === "zruseno") skupina = "probehlo";
    else if (jeNejblizsi) skupina = "nejblizsi";

    var tridy = "karta navsteva-karta nav-stav-" + n.stav +
      " navsteva-skupina-" + skupina +
      (jeNejblizsi ? " navsteva-nejblizsi" : "");
    var html = '<article class="' + esc(tridy) + '" data-id="' + esc(n.id) + '">';

    // 1) stavový řádek — kontrolka + termín + název stavu
    html += '<div class="navsteva-stavradek">';
    html += '<span class="navsteva-kontrolka" aria-hidden="true">' + esc(info.znak) + "</span>";

    var vnitrek = '<span class="navsteva-termin-text">' +
      (n.datum ? esc(formatDatumNavstevy(n)) : "datum neurčeno") + "</span>";
    if (casText) vnitrek += '<span class="navsteva-cas">' + esc(casText) + "</span>";

    if (prava.upravit) {
      html += '<button type="button" class="navsteva-termin navsteva-termin-btn" data-nav-akce="prepnout-termin" ' +
        'aria-expanded="' + (jeOtevrenyPanel(n.id, "termin") ? "true" : "false") + '" ' +
        'title="Upravit termín a čas">' + vnitrek +
        '<span class="navsteva-tuzka" aria-hidden="true">✎</span></button>';
    } else {
      html += '<span class="navsteva-termin">' + vnitrek + "</span>";
    }

    html += '<span class="navsteva-stav-nazev">' + esc(info.nazev) + "</span>";
    if (jeOrientacni) html += '<span class="navsteva-orientacne">orientačně</span>';
    if (jeNejblizsi) html += '<span class="navsteva-znacka-nejblizsi">nejbližší</span>';
    html += "</div>";

    if (jeOtevrenyPanel(n.id, "termin") && prava.upravit) html += htmlInlineTermin(n);

    // 2) hlavička — číslo a název (klik otevře modál s plnou editací)
    html += '<div class="karta-hlavicka"><h4 class="karta-nadpis">' +
      '<button type="button" class="navsteva-nazev-btn" data-nav-akce="otevrit">' +
      "č. " + esc(n.cislo) + " — " + esc(n.nazev) + "</button></h4></div>";

    // 3) rychlý přehled
    html += '<div class="karta-meta">Milník stavby: ' + (milnik ? esc(milnik.nazev) : "bez vazby") + "</div>";
    if ((n.typ || []).length) {
      html += '<div class="navsteva-typy">' + typChipy(n.typ) + "</div>";
    }
    html += '<div class="karta-meta">Za stavbu: ' + htmlZaStavbu(n, lide, true) + "</div>";
    html += '<div class="karta-meta">Za nás: ' + esc(jmenaOsobPodleId(n.za_nas, lide)) + "</div>";

    html += htmlShotNaKarte(n, prava);

    if (n.poznamka) {
      html += '<p class="navsteva-poznamka">' + esc(n.poznamka) + "</p>";
    }
    if (zminujeCasosber(n.poznamka)) {
      html += '<a class="navsteva-odkaz-casosber" href="#casosber">→ Časosběr</a>';
    }

    // 4) akce — posun stavu jedním tlačítkem + detail
    var kroky = htmlKrokyStavu(n, prava);
    html += '<div class="karta-akce navsteva-akce">' + kroky +
      '<button type="button" class="btn btn-mala btn-tiche" data-nav-akce="otevrit">Detail…</button></div>';

    if (jeOtevrenyPanel(n.id, "vraceni") && prava.schvalit) html += htmlInlineVraceni(n);

    html += "</article>";
    return html;
  }

  // ---- vykreslení sekce ----

  function zjistiPrava() {
    function can(kod) {
      return !!(window.Auth && Auth.can && Auth.can(kod));
    }
    return {
      pridat: can("navstevy.pridat"),
      upravit: can("navstevy.upravit"),
      schvalit: can("navstevy.schvalit"),
      mazat: can("navstevy.smazat")
    };
  }

  function vykresli(kontejner) {
    var cil = kontejner || document.getElementById("obsah");
    if (!cil) return;
    cil.dataset.aktivniSekce = "navstevy";
    posledniKontejner = cil;

    var lide = polozkyZeSouboru("lide");
    var plan = polozkyZeSouboru("plan");
    var prava = zjistiPrava();
    var seznam = filtrovaneNavstevy();
    var nejblizsiId = idNejblizsiNavstevy();
    var maNavrhy = ziveNavstevy().some(function (n) { return n.stav === "navrh"; });

    var html = '<div class="sekce-hlava"><h2>Návštěvy</h2><div class="karta-akce">';
    html += '<button type="button" class="btn btn-sekundarni" data-nav-akce="kopirovat-plan">Kopírovat plán jako text</button>';
    if (prava.upravit && maNavrhy) {
      html += '<button type="button" class="btn btn-sekundarni" data-nav-akce="odeslat-vse">Odeslat celý návrh ke schválení</button>';
    }
    if (prava.pridat) {
      html += '<button type="button" class="btn btn-primarni" data-nav-akce="pridat">+ Přidat návštěvu</button>';
    }
    html += "</div></div>";
    html += htmlFiltry();

    if (!seznam.length) {
      html += '<div class="prazdny-stav"><span class="prazdny-stav-ikona" aria-hidden="true"></span>' +
        '<p class="prazdny-stav-text">V tomto filtru nejsou žádné návštěvy.</p></div>';
    } else {
      skupinyPodleRoku(seznam).forEach(function (skupina) {
        html += '<h3 class="navstevy-rok">' + esc(skupina.nadpis) +
          '<span class="navstevy-rok-pocet">' + skupina.polozky.length + "</span></h3>";
        html += '<div class="karty-mrizka navstevy-mrizka">' +
          skupina.polozky.map(function (n) {
            return htmlKarta(n, lide, plan, prava, n.id === nejblizsiId);
          }).join("") + "</div>";
      });
    }

    cil.innerHTML = html;
    napojPosluchace(cil);
    vratFokus(cil);
  }

  // Po uložení inline editace se sekce překreslí a fokus by spadl na <body>.
  // Vrátíme ho na stejné pole, ať se dá plynule pokračovat klávesnicí.
  function vratFokus(cil) {
    if (!fokusPo) return;
    var selektor = fokusPo;
    fokusPo = null;
    var el = cil.querySelector(selektor);
    if (el && typeof el.focus === "function") {
      try {
        el.focus({ preventScroll: true });
      } catch (chyba) {
        el.focus();
      }
    }
  }

  // ---- toasty / chybová hláška / potvrzení (bezpečné fallbacky, viz view-lide.js/view-kos.js) ----

  function toastBezpecne(text, druh) {
    if (window.App && typeof App.toast === "function") {
      App.toast(text, druh);
      return;
    }
    var kontejner = document.getElementById("toasty");
    if (!kontejner) return;
    var el = document.createElement("div");
    el.className = "toast toast-" + (druh || "info");
    var span = document.createElement("span");
    span.className = "toast-text";
    span.textContent = text;
    el.appendChild(span);
    kontejner.appendChild(el);
    setTimeout(function () {
      el.classList.add("toast-mizi");
      setTimeout(function () { el.remove(); }, 300);
    }, druh === "chyba" ? 6000 : 3000);
  }

  function potvrdBezpecne(text) {
    if (window.App && typeof App.potvrd === "function") return Promise.resolve(App.potvrd(text));
    return Promise.resolve(window.confirm(text));
  }

  // Nález auditu: akce spouštěné z otevřeného detailu (dialog) chybovaly do
  // neviditelného řádku v podkladové (zakryté) sekci — přepnuto na App.toast,
  // ten je vidět i nad otevřeným modálem.
  function poChybe(e) {
    toastBezpecne((e && (e.hlaska || e.message)) || "Uložení se nepovedlo.", "chyba");
  }

  // ---- vlastní jednoduchý modál (dialog), stejný vzor jako ve view-lide.js ----

  function otevriModal(nadpis, obsahUzel) {
    var dlg = document.createElement("dialog");
    dlg.className = "modal-okno";

    var hlavicka = document.createElement("div");
    hlavicka.className = "modal-hlavicka";
    var h = document.createElement("h3");
    h.className = "modal-nadpis";
    h.textContent = nadpis;
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

    function zavri() {
      if (dlg.open) dlg.close();
    }
    zavriBtn.addEventListener("click", zavri);
    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) zavri();
    });
    dlg.addEventListener("close", function () {
      dlg.remove();
    });
    dlg.showModal();
    return { dlg: dlg, zavri: zavri };
  }

  // ---- stavba HTML detailu (modál) ----

  function htmlOsazeniPole(nazevPole, vybraneIds, lide, popisek) {
    // „Za nás" = jen náš tým (strana FD), „Za stavbu" = investor a zhotovitel.
    // Dřív se v obou polích nabízeli všichni, takže šlo omylem poslat Michala
    // „za stavbu" a stavbyvedoucího „za nás" — nesmysl, a seznam byl dvakrát
    // tak dlouhý, než musel být.
    var jenNaseStrana = nazevPole === "za_nas";
    var html = '<fieldset class="pole"><legend>' + esc(popisek) + "</legend>";
    STRANY.forEach(function (s) {
      if (jenNaseStrana !== (s[0] === "FD")) return;
      var lidiVeStrane = lide.filter(function (o) { return !o.smazano && o.strana === s[0]; });
      if (!lidiVeStrane.length) return;
      html += '<div class="karta-meta" style="margin:8px 0 2px">' + esc(s[1]) + "</div>";
      lidiVeStrane.forEach(function (o) {
        var checked = vybraneIds.indexOf(o.id) !== -1;
        var cid = "nd-" + nazevPole + "-" + o.id;
        html += '<div class="pole-radek"><input type="checkbox" name="' + nazevPole + '" value="' + esc(o.id) +
          '" id="' + esc(cid) + '"' + (checked ? " checked" : "") + '><label for="' + esc(cid) + '">' + esc(o.jmeno) + "</label></div>";
      });
    });
    html += "</fieldset>";
    return html;
  }

  // Termín a čas se v modálu už needitují — mají vlastní rychlou editaci
  // přímo na kartě v seznamu. Tady se jen vypíšou, ať je detail úplný.
  function htmlTerminVDetailu(n) {
    var info = stavInfo(n.stav);
    var presnost = n.datum_presnost || "presne";
    var jeOrientacni = !!n.datum && (info.orientacne || presnost === "mesic" || presnost === "obdobi");
    var casText = formatCasRozsah(n);

    var html = '<div class="navsteva-stavradek navsteva-stavradek-detail nav-stav-' + esc(n.stav) + '">';
    html += '<span class="navsteva-kontrolka" aria-hidden="true">' + esc(info.znak) + "</span>";
    html += '<span class="navsteva-termin"><span class="navsteva-termin-text">' +
      (n.datum ? esc(formatDatumNavstevy(n)) : "datum neurčeno") + "</span>" +
      (casText ? '<span class="navsteva-cas">' + esc(casText) + "</span>" : "") + "</span>";
    html += '<span class="navsteva-stav-nazev">' + esc(info.nazev) + "</span>";
    if (jeOrientacni) html += '<span class="navsteva-orientacne">orientačně</span>';
    html += "</div>";
    html += '<p class="navsteva-inline-napoveda">Termín, čas a posun stavu se upravují přímo na kartě v seznamu.</p>';
    return html;
  }

  function htmlFormularEditace(n, plan, lide) {
    var html = '<form data-nav-akce-form="ulozit-zmeny" class="formular">';
    html += '<div class="pole"><label for="nd-nazev">Název</label><input id="nd-nazev" name="nazev" type="text" required value="' + esc(n.nazev) + '"></div>';

    html += '<div class="pole"><label for="nd-milnik">Milník stavby</label><select id="nd-milnik" name="milnik_id"><option value="">— bez vazby —</option>';
    plan.filter(function (m) { return !m.smazano; })
      .slice()
      .sort(function (a, b) { return (a.poradi || 0) - (b.poradi || 0); })
      .forEach(function (m) {
        html += '<option value="' + esc(m.id) + '"' + (n.milnik_id === m.id ? " selected" : "") + ">" + esc(m.nazev) + "</option>";
      });
    html += "</select></div>";

    html += '<fieldset class="pole"><legend>Typ</legend>';
    TYP_PORADI.forEach(function (t) {
      var cid = "nd-typ-" + t;
      var checked = (n.typ || []).indexOf(t) !== -1;
      html += '<div class="pole-radek"><input type="checkbox" name="typ" value="' + t + '" id="' + cid + '"' +
        (checked ? " checked" : "") + '><label for="' + cid + '">' + esc(TYP_LABEL[t]) + "</label></div>";
    });
    html += "</fieldset>";

    html += '<div class="pole"><label for="nd-cerpa-foto">Čerpá — foto</label><input id="nd-cerpa-foto" name="cerpa_foto" type="number" min="0" value="' + ((n.cerpa && n.cerpa.foto) || 0) + '"></div>';
    html += '<div class="pole"><label for="nd-cerpa-dron">Čerpá — dron</label><input id="nd-cerpa-dron" name="cerpa_dron" type="number" min="0" value="' + ((n.cerpa && n.cerpa.dron) || 0) + '"></div>';
    html += '<div class="pole"><label for="nd-cerpa-video">Čerpá — video</label><input id="nd-cerpa-video" name="cerpa_video" type="number" min="0" value="' + ((n.cerpa && n.cerpa.video) || 0) + '"></div>';

    html += htmlOsazeniPole("za_stavbu", n.za_stavbu || [], lide, "Za stavbu");
    html += htmlOsazeniPole("za_nas", n.za_nas || [], lide, "Za nás");

    html += '<div class="pole"><label for="nd-poznamka">Poznámka</label><textarea id="nd-poznamka" name="poznamka" rows="3">' + esc(n.poznamka || "") + "</textarea></div>";

    html += '<div class="formular-chyba chyba-hlaska" hidden></div>';
    html += '<div class="karta-akce"><button type="submit" class="btn btn-primarni">Uložit změny</button></div>';
    html += "</form>";
    return html;
  }

  function htmlDetailCteni(n, plan, lide) {
    var milnik = n.milnik_id ? najdiPodleId(plan, n.milnik_id) : null;
    var html = '<dl style="display:flex;flex-direction:column;gap:6px" class="karta-meta">';
    if (milnik) html += "<div><strong>Milník stavby:</strong> " + esc(milnik.nazev) + "</div>";
    if ((n.typ || []).length) html += "<div><strong>Typ:</strong> " + typChipy(n.typ) + "</div>";
    html += "<div><strong>Čerpá:</strong> foto " + ((n.cerpa && n.cerpa.foto) || 0) +
      " · dron " + ((n.cerpa && n.cerpa.dron) || 0) + " · video " + ((n.cerpa && n.cerpa.video) || 0) + "</div>";
    html += "<div><strong>Za stavbu:</strong> " + htmlZaStavbu(n, lide, false) + "</div>";
    html += "<div><strong>Za nás:</strong> " + esc(seznamOsobPodleId(n.za_nas, lide)) + "</div>";
    if (n.poznamka) html += "<div><strong>Poznámka:</strong> " + esc(n.poznamka) + "</div>";
    html += "</dl>";
    return html;
  }

  function htmlShotList(n, smiUpravit) {
    var polozky = n.co_se_toci || [];
    var html = '<div class="oddil"><h3 class="nadpis-sekce" style="font-size:1rem">Shot list</h3>';
    if (!polozky.length) {
      html += '<p class="podnadpis-sekce" style="margin:0">Zatím žádné položky.</p>';
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:6px">';
      polozky.forEach(function (p) {
        if (smiUpravit) {
          html += '<div class="pole-radek">' +
            '<input type="checkbox" data-nav-akce="shot-prepnout" data-polozka="' + esc(p.id) + '"' +
            (p.hotovo ? " checked" : "") + ' id="shot-' + esc(p.id) + '">' +
            '<label for="shot-' + esc(p.id) + '" style="flex:1 1 auto' +
            (p.hotovo ? ";text-decoration:line-through;color:var(--text-slaby)" : "") + '">' + esc(p.text) + "</label>" +
            '<button type="button" class="btn-ikonovy btn-nebezpecny" data-nav-akce="shot-smazat" data-polozka="' +
            esc(p.id) + '" aria-label="Smazat položku" title="Smazat">×</button>' +
            "</div>";
        } else {
          html += '<div class="pole-radek"><span aria-hidden="true">' + (p.hotovo ? "☑" : "☐") + "</span><span" +
            (p.hotovo ? ' style="text-decoration:line-through;color:var(--text-slaby)"' : "") + ">" + esc(p.text) + "</span></div>";
        }
      });
      html += "</div>";
    }
    if (smiUpravit) {
      html += '<form data-nav-akce-form="shot-pridat" style="display:flex;gap:8px;margin-top:10px">' +
        '<input type="text" name="text" placeholder="Nová položka shot listu…" required ' +
        'style="flex:1 1 auto;background:var(--panel-2);border:1px solid var(--linka);color:var(--text);border-radius:2px;padding:10px 12px;min-height:44px">' +
        '<button type="submit" class="btn btn-sekundarni">Přidat</button></form>';
    }
    html += "</div>";
    return html;
  }

  function htmlSchvalovani(n, smiSchvalit, smiUpravit, lide) {
    var html = '<div class="oddil"><h3 class="nadpis-sekce" style="font-size:1rem">Schvalování</h3>';
    html += '<p class="karta-meta">Aktuální stav: <span class="stitek nav-stav-' + esc(n.stav) + '">' +
      esc(stavNazev(n.stav)) + "</span></p>";

    if (n.schvaleni && n.schvaleni.kdo) {
      var schvalil = najdiPodleId(lide, n.schvaleni.kdo);
      html += '<p class="karta-meta">Schválil(a): ' + esc(schvalil ? schvalil.jmeno : n.schvaleni.kdo) +
        (n.schvaleni.kdy ? " · " + esc(Util.formatCas(n.schvaleni.kdy)) : "") + "</p>";
    }
    if (n.schvaleni && n.schvaleni.poznamka) {
      html += '<p class="karta-meta">Poznámka ke schvalování: ' + esc(n.schvaleni.poznamka) + "</p>";
    }

    html += '<div class="karta-akce">';
    if (n.stav === "navrh" && smiUpravit) {
      html += '<button type="button" class="btn btn-primarni" data-nav-akce="odeslat-ke-schvaleni">Odeslat ke schválení</button>';
    }
    if (n.stav === "ke-schvaleni" && smiSchvalit) {
      html += '<button type="button" class="btn btn-primarni" data-nav-akce="schvalit">Schválit</button>';
      html += '<button type="button" class="btn btn-sekundarni" data-nav-akce="zobrazit-vraceni">Vrátit k přepracování</button>';
    }
    if (n.stav === "schvaleno" && smiUpravit) {
      html += '<button type="button" class="btn btn-primarni" data-nav-akce="potvrdit-termin">Potvrdit termín</button>';
    }
    if (n.stav === "potvrzeno" && smiUpravit) {
      html += '<button type="button" class="btn btn-primarni" data-nav-akce="oznacit-probehlo">Označit jako proběhlo</button>';
    }
    html += "</div>";

    html += '<div class="pole" data-vraceni-box hidden style="margin-top:10px">' +
      '<label for="nd-vraceni-text">Důvod vrácení (min. 3 znaky)</label>' +
      '<textarea id="nd-vraceni-text" rows="2"></textarea>' +
      '<div class="chybove-pole-text" style="color:var(--chyba);font-size:0.8rem;display:none"></div>' +
      '<div class="karta-akce" style="margin-top:8px">' +
      '<button type="button" class="btn btn-primarni" data-nav-akce="potvrdit-vraceni">Potvrdit vrácení</button>' +
      '<button type="button" class="btn btn-tiche" data-nav-akce="zrusit-vraceni">Zrušit</button>' +
      "</div></div>";

    html += "</div>";
    return html;
  }

  // Řádek „Upozornění: …" u komentáře. Tahle sekce skládá HTML řetězcem,
  // takže se text bere z Util.zminkyText a POVINNĚ prochází esc().
  function htmlRadekZminek(zaznam) {
    var text = Util.zminkyText(Util.zminky(zaznam));
    if (!text) return "";
    return '<p class="karta-meta zminky-radek">' + esc(text) + "</p>";
  }

  function htmlKomentare(n, aktivita, lide, smiKomentovat, smiMazatCizi) {
    var mojeId = (window.Auth && Auth.ja && Auth.ja.id) || null;
    var seznam = aktivita.filter(function (a) {
      return !a.smazano && a.druh === "komentar" && a.entita === "navsteva" && a.entita_id === n.id;
    }).slice().sort(function (a, b) { return String(b.kdy).localeCompare(String(a.kdy)); });

    var html = '<div class="oddil"><h3 class="nadpis-sekce" style="font-size:1rem">Komentáře</h3>';
    if (!seznam.length) {
      html += '<p class="podnadpis-sekce" style="margin:0 0 10px">Zatím žádné komentáře.</p>';
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px">';
      seznam.forEach(function (a) {
        var muzeSmazat = (smiKomentovat && a.kdo === mojeId) || smiMazatCizi;
        html += '<div class="karta" style="padding:8px 12px">' +
          '<div class="karta-meta">' + esc(jmenoAutora(a.kdo, lide)) + " · " + esc(Util.formatCas(a.kdy)) +
          (muzeSmazat
            ? ' <button type="button" class="btn-ikonovy btn-nebezpecny" data-nav-akce="smazat-komentar" data-komentar="' +
              esc(a.id) + '" aria-label="Smazat komentář" title="Smazat" style="float:right">×</button>'
            : "") +
          '</div><div class="karta-popis">' + esc(a.text) + "</div>" +
          htmlRadekZminek(a) + "</div>";
      });
      html += "</div>";
    }
    if (smiKomentovat) {
      html += '<form data-nav-akce-form="pridat-komentar" style="display:flex;flex-direction:column;gap:8px">' +
        '<textarea name="text" rows="2" required placeholder="Napsat komentář…" ' +
        'style="background:var(--panel-2);border:1px solid var(--linka);color:var(--text);border-radius:2px;padding:10px 12px"></textarea>' +
        // Sem doplní výběr lidí k označení dopluVyberZminek() hned po vložení
        // HTML — Util.vyberZminek vrací PRVEK, ne řetězec (a je to tak dobře:
        // žádné skládání uživatelských dat do innerHTML).
        '<div data-zminky-misto></div>' +
        '<div><button type="submit" class="btn btn-primarni">Odeslat</button></div></form>';
    }
    html += "</div>";
    return html;
  }

  function htmlNebezpecnaZona(n, smiMazat) {
    if (!smiMazat) return "";
    var html = '<div class="oddil" style="border-top:1px solid var(--linka);padding-top:14px">';
    html += '<div class="karta-akce">';
    if (n.stav !== "zruseno") {
      html += '<button type="button" class="btn btn-nebezpecny" data-nav-akce="zrusit-navstevu">Zrušit návštěvu</button>';
    }
    html += '<button type="button" class="btn btn-nebezpecny" data-nav-akce="presunout-do-kose">Přesunout do koše</button>';
    html += "</div></div>";
    return html;
  }

  function htmlDetail(n) {
    var plan = polozkyZeSouboru("plan");
    var lide = polozkyZeSouboru("lide");
    var aktivita = polozkyZeSouboru("aktivita");
    var smiUpravit = !!(window.Auth && Auth.can && Auth.can("navstevy.upravit"));
    var smiSchvalit = !!(window.Auth && Auth.can && Auth.can("navstevy.schvalit"));
    var smiMazat = !!(window.Auth && Auth.can && Auth.can("navstevy.smazat"));
    var smiKomentovat = !!(window.Auth && Auth.can && Auth.can("komentare.pridat"));
    var smiMazatCizi = !!(window.Auth && Auth.can && Auth.can("komentare.smazat.cizi"));

    var html = '<p class="karta-meta">Návštěva č. ' + n.cislo + "</p>";
    html += htmlTerminVDetailu(n);
    html += smiUpravit ? htmlFormularEditace(n, plan, lide) : htmlDetailCteni(n, plan, lide);
    html += htmlShotList(n, smiUpravit);
    html += htmlSchvalovani(n, smiSchvalit, smiUpravit, lide);
    html += htmlKomentare(n, aktivita, lide, smiKomentovat, smiMazatCizi);
    html += htmlNebezpecnaZona(n, smiMazat);
    return html;
  }

  // ---- modál — otevření / překreslení ----

  // Detail se vykresluje jedním innerHTML, ale výběr lidí k označení je
  // živý prvek z Util.vyberZminek — proto se po každém překreslení vloží
  // na svoje místo znovu. `vyberZminekKomentare` drží ten aktuální, ať se
  // dá při odeslání zeptat, kdo je zaškrtnutý.
  var vyberZminekKomentare = null;

  function dopluVyberZminek(koren) {
    vyberZminekKomentare = null;
    if (!koren) return;
    var misto = koren.querySelector("[data-zminky-misto]");
    if (!misto) return;
    vyberZminekKomentare = Util.vyberZminek({
      vynech: (window.Auth && Auth.ja && Auth.ja.osoba_id) || null
    });
    misto.appendChild(vyberZminekKomentare.prvek);
  }

  function otevriDetail(id) {
    var n = najdiPodleId(polozkyZeSouboru("navstevy"), id);
    if (!n) return;
    idOtevrenehoDetailu = id;

    modalObsahUzel = document.createElement("div");
    napojPosluchaceDetail(modalObsahUzel);
    modalObsahUzel.innerHTML = htmlDetail(n);
    dopluVyberZminek(modalObsahUzel);

    modalRef = otevriModal("Návštěva — " + n.nazev, modalObsahUzel);
    modalRef.dlg.addEventListener("close", function () {
      idOtevrenehoDetailu = null;
      modalObsahUzel = null;
      modalRef = null;
      vyberZminekKomentare = null;
    });
  }

  function prekresliDetail() {
    if (!idOtevrenehoDetailu || !modalObsahUzel) return;
    var n = najdiPodleId(polozkyZeSouboru("navstevy"), idOtevrenehoDetailu);
    if (!n) {
      if (modalRef) modalRef.zavri();
      return;
    }
    modalObsahUzel.innerHTML = htmlDetail(n);
    dopluVyberZminek(modalObsahUzel);
  }

  // ---- mutace dat ----

  function transakce(id, mutator, popis) {
    return GH.zmen("navstevy", function (polozky) {
      var n = polozky.find(function (x) { return x.id === id; });
      if (!n) throw new Error("Návštěva už mezitím zmizela (byla smazána nebo obnovena jinam).");
      mutator(n);
    }, popis);
  }

  function poUspechuNavstevy(obsah) {
    if (window.App && typeof App.uloz === "function") App.uloz("navstevy", obsah);
    vykresli(posledniKontejner);
    prekresliDetail();
  }

  function odeslatKeSchvaleni(id) {
    transakce(id, function (n) { n.stav = "ke-schvaleni"; }, "Odesláno ke schválení — návštěva č. " + cisloNavstevy(id))
      .then(poUspechuNavstevy).catch(poChybe);
  }

  function schvalit(id) {
    transakce(id, function (n) {
      n.stav = "schvaleno";
      n.schvaleni = {
        kdo: (window.Auth && Auth.ja && Auth.ja.osoba_id) || null,
        kdy: new Date().toISOString(),
        poznamka: (n.schvaleni && n.schvaleni.poznamka) || ""
      };
    }, "Schváleno — návštěva č. " + cisloNavstevy(id)).then(poUspechuNavstevy).catch(poChybe);
  }

  function potvrditTermin(id) {
    transakce(id, function (n) { n.stav = "potvrzeno"; }, "Potvrzen termín — návštěva č. " + cisloNavstevy(id))
      .then(poUspechuNavstevy).catch(poChybe);
  }

  function oznacitProbehlo(id) {
    transakce(id, function (n) { n.stav = "probehlo"; }, "Označeno jako proběhlé — návštěva č. " + cisloNavstevy(id))
      .then(poUspechuNavstevy).catch(poChybe);
  }

  function vratitDoNavrhu(id, poznamkaText) {
    var cislo = cisloNavstevy(id);
    panelOtevreny = null;
    transakce(id, function (n) {
      n.stav = "navrh";
      n.schvaleni = { kdo: null, kdy: null, poznamka: poznamkaText };
    }, "Vráceno k přepracování — návštěva č. " + cislo)
      .then(function (obsah) {
        poUspechuNavstevy(obsah);
        return pridatKomentarZaznam(id, poznamkaText);
      })
      .catch(poChybe);
  }

  function zrusitNavstevu(id) {
    transakce(id, function (n) { n.stav = "zruseno"; }, "Zrušena návštěva č. " + cisloNavstevy(id))
      .then(poUspechuNavstevy).catch(poChybe);
  }

  function presunoutDoKose(id) {
    transakce(id, function (n) {
      n.smazano = { kdy: new Date().toISOString(), kdo: (window.Auth && Auth.ja && Auth.ja.osoba_id) || null };
    }, "Smazána návštěva č. " + cisloNavstevy(id))
      .then(function (obsah) {
        if (window.App && typeof App.uloz === "function") App.uloz("navstevy", obsah);
        if (panelOtevreny && panelOtevreny.id === id) panelOtevreny = null;
        delete shotOtevrene[id];
        vykresli(posledniKontejner);
        if (modalRef) modalRef.zavri();
      })
      .catch(poChybe);
  }

  // Rychlá inline editace termínu — zmeny je částečný objekt polí návštěvy.
  // Po zápisu se rozsah "období" srovná, ať nikdy nevznikne nesmysl typu
  // "listopad–říjen 2026" (konec dřív než začátek).
  function ulozTermin(id, zmeny) {
    transakce(id, function (n) {
      Object.keys(zmeny).forEach(function (klic) { n[klic] = zmeny[klic]; });
      if ((n.datum_presnost || "presne") !== "obdobi") {
        n.datum_do = null;
      } else if (n.datum && n.datum_do && n.datum_do < n.datum) {
        n.datum_do = n.datum;
      }
    }, "Upraven termín — návštěva č. " + cisloNavstevy(id))
      .then(poUspechuNavstevy).catch(poChybe);
  }

  function shotPridat(id, text) {
    transakce(id, function (n) {
      (n.co_se_toci = n.co_se_toci || []).push({ id: GH.noveId("polozka"), text: text.trim(), hotovo: false });
    }, "Přidána položka shot listu — návštěva č. " + cisloNavstevy(id)).then(poUspechuNavstevy).catch(poChybe);
  }

  function shotPrepnout(id, polozkaId) {
    transakce(id, function (n) {
      var p = (n.co_se_toci || []).find(function (x) { return x.id === polozkaId; });
      if (p) p.hotovo = !p.hotovo;
    }, "Upraven shot list — návštěva č. " + cisloNavstevy(id)).then(poUspechuNavstevy).catch(poChybe);
  }

  function shotSmazat(id, polozkaId) {
    transakce(id, function (n) {
      n.co_se_toci = (n.co_se_toci || []).filter(function (x) { return x.id !== polozkaId; });
    }, "Smazána položka shot listu — návštěva č. " + cisloNavstevy(id)).then(poUspechuNavstevy).catch(poChybe);
  }

  // Komentář se zapisuje přímo do aktivita.json (entita_id vyplněné) — auto-log
  // z GH.zmen entita_id nedostává, viz POZNAMKY_B-krypto-auth.md bod 1.
  function pridatKomentarZaznam(entitaId, text, zminky) {
    return GH.zmen("aktivita", function (polozky) {
      polozky.push({
        id: GH.noveId("akt"),
        entita: "navsteva",
        entita_id: entitaId,
        druh: "komentar",
        text: text,
        zminky: Array.isArray(zminky) ? zminky : [],
        kdo: (window.Auth && Auth.ja && Auth.ja.id) || "neznamy",
        kdy: new Date().toISOString(),
        smazano: null
      });
    }, "Komentář u návštěvy č. " + cisloNavstevy(entitaId))
      .then(function (obsah) {
        if (window.App && typeof App.uloz === "function") App.uloz("aktivita", obsah);
        vykresli(posledniKontejner);
        prekresliDetail();
        return obsah;
      });
  }

  function smazatKomentar(komentarId) {
    GH.zmen("aktivita", function (polozky) {
      var a = polozky.find(function (x) { return x.id === komentarId; });
      if (a) a.smazano = { kdy: new Date().toISOString(), kdo: (window.Auth && Auth.ja && Auth.ja.osoba_id) || null };
    }, "Smazán komentář")
      .then(function (obsah) {
        if (window.App && typeof App.uloz === "function") App.uloz("aktivita", obsah);
        vykresli(posledniKontejner);
        prekresliDetail();
      })
      .catch(poChybe);
  }

  function ukazChybuFormulare(form, text) {
    var el = form.querySelector(".formular-chyba");
    if (!el) return;
    el.hidden = false;
    el.textContent = text;
  }

  // Formulář v modálu už NEobsahuje datum/přesnost/čas — ta pole se editují
  // inline na kartě, takže se tu ani nesmí přepisovat (jinak by se vynulovala).
  function ulozitZmeny(id, form) {
    var fd = new FormData(form);
    var nazev = String(fd.get("nazev") || "").trim();
    if (!nazev) {
      ukazChybuFormulare(form, "Vyplň název.");
      return;
    }
    var zaznam = {
      nazev: nazev,
      milnik_id: String(fd.get("milnik_id") || "").trim() || null,
      typ: fd.getAll("typ"),
      cerpa: {
        foto: parseInt(fd.get("cerpa_foto"), 10) || 0,
        dron: parseInt(fd.get("cerpa_dron"), 10) || 0,
        video: parseInt(fd.get("cerpa_video"), 10) || 0
      },
      za_stavbu: fd.getAll("za_stavbu"),
      za_nas: fd.getAll("za_nas"),
      poznamka: String(fd.get("poznamka") || "").trim()
    };

    var tlacitko = form.querySelector('button[type="submit"]');
    if (tlacitko) tlacitko.disabled = true;

    transakce(id, function (n) {
      n.nazev = zaznam.nazev;
      n.milnik_id = zaznam.milnik_id;
      n.typ = zaznam.typ;
      n.cerpa = zaznam.cerpa;
      n.za_stavbu = zaznam.za_stavbu;
      n.za_nas = zaznam.za_nas;
      n.poznamka = zaznam.poznamka;
    }, "Upravena návštěva č. " + cisloNavstevy(id))
      .then(function (obsah) {
        poUspechuNavstevy(obsah);
        // Po uložení okno zavřít a říct to nahlas. Bez toho detail zůstal
        // otevřený a beze změny — vypadalo to, že se návštěva nedá upravit,
        // i když se data v pořádku uložila.
        if (modalRef && modalRef.dlg && modalRef.dlg.open) modalRef.dlg.close();
        if (window.App && typeof App.toast === "function") {
          App.toast("Návštěva uložena.", "ok");
        }
      })
      .catch(function (e) {
        ukazChybuFormulare(form, (e && (e.hlaska || e.message)) || "Uložení se nepovedlo.");
      })
      .finally(function () {
        if (tlacitko) tlacitko.disabled = false;
      });
  }

  function pridatNavstevu() {
    var vsechny = polozkyZeSouboru("navstevy");
    var nejvyssiCislo = vsechny.reduce(function (m, n) { return Math.max(m, n.cislo || 0); }, 0);
    var zaznam = {
      id: GH.noveId("nav"),
      cislo: nejvyssiCislo + 1,
      nazev: "Nová návštěva",
      milnik_id: null,
      datum: null,
      datum_presnost: "mesic",
      datum_do: null,
      cas_od: null,
      cas_do: null,
      typ: [],
      cerpa: { foto: 0, dron: 0, video: 0 },
      co_se_toci: [],
      za_stavbu: [],
      za_nas: [],
      stav: "navrh",
      schvaleni: { kdo: null, kdy: null, poznamka: "" },
      poznamka: "",
      smazano: null
    };
    GH.zmen("navstevy", function (polozky) { polozky.push(zaznam); }, "Přidána návštěva č. " + zaznam.cislo)
      .then(function (obsah) {
        if (window.App && typeof App.uloz === "function") App.uloz("navstevy", obsah);
        vykresli(posledniKontejner);
        otevriDetail(zaznam.id);
      })
      .catch(poChybe);
  }

  function odeslatVseKeSchvaleni() {
    var kandidati = ziveNavstevy().filter(function (n) { return n.stav === "navrh"; });
    if (!kandidati.length) {
      toastBezpecne("Není co odeslat — žádná návštěva není ve stavu Návrh.", "info");
      return;
    }
    potvrdBezpecne("Odeslat všech " + kandidati.length + " návštěv ve stavu Návrh ke schválení jedním commitem?").then(function (ok) {
      if (!ok) return;
      GH.zmen("navstevy", function (polozky) {
        polozky.forEach(function (n) {
          if (!n.smazano && n.stav === "navrh") n.stav = "ke-schvaleni";
        });
      }, "Odesláno " + kandidati.length + " návštěv ke schválení najednou")
        .then(function (obsah) {
          if (window.App && typeof App.uloz === "function") App.uloz("navstevy", obsah);
          vykresli(posledniKontejner);
          toastBezpecne("Odesláno ke schválení.", "ok");
        })
        .catch(poChybe);
    });
  }

  function kopirovatPlan() {
    var text = textCelehoPlanu();
    Util.doSchranky(text).then(function (ok) {
      toastBezpecne(ok ? "Plán zkopírován do schránky." : "Kopírování se nepovedlo.", ok ? "ok" : "chyba");
    });
  }

  // ---- posluchače v seznamu ----

  function idKarty(prvek) {
    var karta = prvek.closest("[data-id]");
    return karta ? karta.dataset.id : null;
  }

  function napojPosluchace(cil) {
    if (cil._navstevyNapojeno) return;
    cil._navstevyNapojeno = true;

    cil.addEventListener("click", function (e) {
      if (cil.dataset.aktivniSekce !== "navstevy") return;
      var prvek = e.target.closest("[data-nav-akce]");
      if (!prvek) {
        // Klik kamkoli do karty (mimo ovládací prvky) otevře detail. Lidé
        // klikají na kartu, ne na drobné „Detail…" v rohu — bez tohohle to
        // působí, jako by se návštěva nedala upravovat.
        var karta = e.target.closest("article[data-id]");
        if (!karta) return;
        if (e.target.closest("button, a, input, select, textarea, label, summary")) return;
        otevriDetail(karta.dataset.id);
        return;
      }
      var akce = prvek.dataset.navAkce;

      if (akce === "filtr") {
        filtrAktualni = prvek.dataset.filtr;
        panelOtevreny = null;
        vykresli(posledniKontejner);
        return;
      }
      if (akce === "pridat") { pridatNavstevu(); return; }
      if (akce === "odeslat-vse") { odeslatVseKeSchvaleni(); return; }
      if (akce === "kopirovat-plan") { kopirovatPlan(); return; }

      var id = idKarty(prvek);
      if (!id) return;

      if (akce === "otevrit") {
        otevriDetail(id);
      } else if (akce === "prepnout-termin") {
        nastavPanel(id, "termin");
        if (jeOtevrenyPanel(id, "termin")) fokusPo = '[data-id="' + id + '"] [name="inline-datum"]';
        vykresli(posledniKontejner);
      } else if (akce === "zavrit-panel") {
        panelOtevreny = null;
        vykresli(posledniKontejner);
      } else if (akce === "stav-odeslat") {
        odeslatKeSchvaleni(id);
      } else if (akce === "stav-schvalit") {
        schvalit(id);
      } else if (akce === "stav-potvrdit") {
        potvrditTermin(id);
      } else if (akce === "stav-probehlo") {
        oznacitProbehlo(id);
      } else if (akce === "stav-vratit") {
        nastavPanel(id, "vraceni");
        if (jeOtevrenyPanel(id, "vraceni")) fokusPo = '[data-id="' + id + '"] [name="inline-vraceni"]';
        vykresli(posledniKontejner);
      } else if (akce === "potvrdit-vraceni-karta") {
        var karta = prvek.closest("[data-id]");
        var pole = karta ? karta.querySelector('[name="inline-vraceni"]') : null;
        var chybaEl = karta ? karta.querySelector(".navsteva-inline-chyba") : null;
        var text = pole ? pole.value.trim() : "";
        if (text.length < 3) {
          if (chybaEl) {
            chybaEl.hidden = false;
            chybaEl.textContent = "Napiš prosím alespoň 3 znaky.";
          }
          if (pole) pole.focus();
          return;
        }
        vratitDoNavrhu(id, text);
      }
    });

    // Inline editace termínu a zaškrtávání shot listu — ukládá se hned.
    cil.addEventListener("change", function (e) {
      if (cil.dataset.aktivniSekce !== "navstevy") return;
      var t = e.target;
      if (!t || !t.name) return;
      var id = idKarty(t);
      if (!id) return;

      var navsteva = najdiPodleId(polozkyZeSouboru("navstevy"), id);
      if (!navsteva) return;

      if (t.name === "shot-karta") {
        shotPrepnout(id, t.dataset.polozka);
        return;
      }

      fokusPo = '[data-id="' + id + '"] [name="' + t.name + '"]';

      if (t.name === "inline-datum") {
        ulozTermin(id, { datum: t.value || null });
      } else if (t.name === "inline-presnost") {
        var presnost = t.value || "presne";
        var zmeny = { datum_presnost: presnost };
        // "období" potřebuje druhý konec; u ostatních přesností nedává smysl.
        zmeny.datum_do = presnost === "obdobi" ? (navsteva.datum_do || navsteva.datum || null) : null;
        ulozTermin(id, zmeny);
      } else if (t.name === "inline-datum-do") {
        ulozTermin(id, { datum_do: t.value || null });
      } else if (t.name === "inline-cas-od") {
        ulozTermin(id, { cas_od: t.value || null });
      } else if (t.name === "inline-cas-do") {
        ulozTermin(id, { cas_do: t.value || null });
      }
    });

    // <details> shot listu na kartě — "toggle" nebublá, proto zachytávání.
    cil.addEventListener("toggle", function (e) {
      if (cil.dataset.aktivniSekce !== "navstevy") return;
      var det = e.target;
      if (!det || !det.classList || !det.classList.contains("navsteva-shot")) return;
      var id = idKarty(det);
      if (!id) return;
      if (det.open) {
        shotOtevrene[id] = true;
      } else {
        delete shotOtevrene[id];
      }
    }, true);
  }

  // ---- posluchače v modálu ----

  function napojPosluchaceDetail(obsahUzel) {
    obsahUzel.addEventListener("click", function (e) {
      var prvek = e.target.closest("[data-nav-akce]");
      if (!prvek) return;
      var akce = prvek.dataset.navAkce;
      var id = idOtevrenehoDetailu;
      if (!id) return;

      if (akce === "shot-smazat") {
        shotSmazat(id, prvek.dataset.polozka);
      } else if (akce === "odeslat-ke-schvaleni") {
        odeslatKeSchvaleni(id);
      } else if (akce === "schvalit") {
        schvalit(id);
      } else if (akce === "potvrdit-termin") {
        potvrditTermin(id);
      } else if (akce === "oznacit-probehlo") {
        oznacitProbehlo(id);
      } else if (akce === "zobrazit-vraceni") {
        var box = obsahUzel.querySelector("[data-vraceni-box]");
        if (box) {
          box.hidden = false;
          var ta = box.querySelector("textarea");
          if (ta) ta.focus();
        }
      } else if (akce === "zrusit-vraceni") {
        var box2 = obsahUzel.querySelector("[data-vraceni-box]");
        if (box2) box2.hidden = true;
      } else if (akce === "potvrdit-vraceni") {
        var box3 = obsahUzel.querySelector("[data-vraceni-box]");
        var ta3 = box3 ? box3.querySelector("textarea") : null;
        var textVraceni = ta3 ? ta3.value.trim() : "";
        var chybaEl = box3 ? box3.querySelector(".chybove-pole-text") : null;
        if (textVraceni.length < 3) {
          if (chybaEl) {
            chybaEl.textContent = "Napiš prosím alespoň 3 znaky.";
            chybaEl.style.display = "block";
          }
          return;
        }
        vratitDoNavrhu(id, textVraceni);
      } else if (akce === "zrusit-navstevu") {
        potvrdBezpecne("Opravdu zrušit návštěvu č. " + cisloNavstevy(id) + "?").then(function (ok) {
          if (ok) zrusitNavstevu(id);
        });
      } else if (akce === "presunout-do-kose") {
        potvrdBezpecne("Opravdu přesunout návštěvu č. " + cisloNavstevy(id) + " do koše?").then(function (ok) {
          if (ok) presunoutDoKose(id);
        });
      } else if (akce === "smazat-komentar") {
        potvrdBezpecne("Opravdu smazat tento komentář?").then(function (ok) {
          if (ok) smazatKomentar(prvek.dataset.komentar);
        });
      }
    });

    obsahUzel.addEventListener("change", function (e) {
      if (!idOtevrenehoDetailu) return;
      if (e.target.matches && e.target.matches('[data-nav-akce="shot-prepnout"]')) {
        shotPrepnout(idOtevrenehoDetailu, e.target.dataset.polozka);
      }
    });

    obsahUzel.addEventListener("submit", function (e) {
      var form = e.target;
      if (!form.matches || !form.matches("[data-nav-akce-form]")) return;
      e.preventDefault();
      var id = idOtevrenehoDetailu;
      if (!id) return;
      var typAkce = form.dataset.navAkceForm;

      if (typAkce === "ulozit-zmeny") {
        ulozitZmeny(id, form);
      } else if (typAkce === "shot-pridat") {
        var vstup = form.querySelector('[name="text"]');
        var textPolozky = vstup ? vstup.value : "";
        if (textPolozky.trim()) shotPridat(id, textPolozky);
      } else if (typAkce === "pridat-komentar") {
        var pole = form.querySelector('[name="text"]');
        var txt = pole ? pole.value.trim() : "";
        var oznaceni = vyberZminekKomentare ? vyberZminekKomentare.vybrane() : [];
        if (txt) pridatKomentarZaznam(id, txt, oznaceni).catch(poChybe);
      }
    });
  }

  // ---- registrace sekce (viz vysvětlení v view-lide.js) ----

  document.addEventListener("DOMContentLoaded", function () {
    if (window.App && typeof App.registrujSekci === "function") {
      App.registrujSekci("navstevy", vykresli);
    }
  });
})();
