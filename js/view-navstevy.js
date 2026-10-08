/*
 * view-navstevy.js — sekce "Návštěvy" (KONTRAKT.md §9.2 a celý §6 — schvalovací
 * kolečko natáčecích návštěv).
 *
 * PŘESTAVBA 8. 10. 2026 podle zadání majitele „zjednoduš to jako top AAA UI
 * designer“. Dřív to byl sloupec 16+ vysokých karet, z nichž každá ukazovala
 * všechno a „Upravit tady“ v ní rozbalilo celý formulář. Teď:
 *
 *   1) pruh „Čeká na vás“ — max. 5 návštěv, u kterých se od nás něco čeká
 *      (schválit, potvrdit, označit jako proběhlé, odeslat ke schválení),
 *      každá s jedním tlačítkem;
 *   2) „Příště“ — jediná výrazná karta nejbližší návštěvy (datum, odpočet,
 *      lidé, odškrtávací body „Co se natočí“, poslední komentář);
 *   3) „Plán“ — kompaktní řádky po letech (jeden řádek = jedna návštěva,
 *      klik otevře detail);
 *   4) „Proběhlo“ — sbalený seznam hotových a zrušených návštěv.
 *
 * Karty se nikdy nenatahují: veškeré úpravy (termín, shot list, komentáře,
 * schvalování, podrobnosti, nebezpečná zóna) jsou výhradně v BOČNÍM PANELU
 * (dialog s třídou nv-panel), který se otevře klikem na řádek / kartu.
 * Hromadné akce („Kopírovat plán jako text“, „Odeslat celý návrh ke
 * schválení“) jsou schované v menu ⋯ v hlavičce.
 *
 * Barvy stavů dle KONTRAKT.md §8 řeší CSS (třídy nv-stav-STAV):
 *   navrh šedá · ke-schvaleni oranžová · schvaleno modrá · potvrzeno zelená ·
 *   probehlo tmavě zelená · zruseno červená.
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
 * text a odškrtnuté body bez možnosti měnit je.
 *
 * Návštěvy, které mají v poznámce zmínku o sekci Časosběr, dostanou
 * v panelu odkaz "→ Časosběr" na #casosber (dodatek §A).
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

  // Sbalený seznam „Proběhlo“ (<details>) — drží se v modulu, aby se po
  // překreslení (každý zápis dat) znovu nesbalil.
  var probehloOtevrene = false;
  // Selektor prvku, na který se má po překreslení vrátit fokus.
  var fokusPo = null;
  // Boční panel: true = v sekci „Podrobnosti“ je místo čtení formulář úprav.
  var detailUpravy = false;
  // Komentář psaný rovnou na kartě „Příště“ (Franta 8. 10. 2026): je formulář
  // otevřený a co je v něm rozepsané — data se obnovují samy a karta se
  // překresluje, rozepsaný text se nesmí ztratit.
  var komentarVPristi = false;
  var komentarVPristiText = "";
  // Menu ⋯ v hlavičce — dokumentové posluchače (klik mimo, Esc) se věší jen jednou.
  var menuNapojeno = false;

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

  // Jen jména bez telefonů — do karty „Příště“, kde jde o rychlý přehled.
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

  // Zmínka o sekci Časosběr v poznámce -> v panelu odkaz "→ Časosběr".
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

  // ---- seznam: řazení, seskupení po letech, příští návštěva ----

  function ziveNavstevy() {
    return polozkyZeSouboru("navstevy").filter(function (n) { return !n.smazano; });
  }

  function jeDokoncena(n) {
    return n.stav === "probehlo" || n.stav === "zruseno";
  }

  // Chronologicky (datum), při shodě podle čísla. Návštěvy bez data jdou
  // na konec — spadnou do skupiny "Bez termínu".
  function porovnejNavstevy(a, b) {
    var da = a.datum || "9999-99-99";
    var db = b.datum || "9999-99-99";
    if (da !== db) return da < db ? -1 : 1;
    return (a.cislo || 0) - (b.cislo || 0);
  }

  // Nejnovější nahoře (sekce „Proběhlo“); bez data až na konec.
  function porovnejSestupne(a, b) {
    var da = a.datum || "";
    var db = b.datum || "";
    if (da !== db) return da < db ? 1 : -1;
    return (b.cislo || 0) - (a.cislo || 0);
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

  // Poslední den, kdy termín ještě platí. U přesného data ten den, u měsíční
  // přesnosti konec měsíce, u období datum_do. Bez toho by návštěva
  // „říjen 2026“ uložená jako 1. 10. byla 2. října už „po termínu“.
  function konecTerminuIso(n) {
    if (!n.datum) return null;
    var presnost = n.datum_presnost || "presne";
    if (presnost === "obdobi" && n.datum_do) return n.datum_do;
    if (presnost === "mesic") {
      var p = /^(\d{4})-(\d{2})/.exec(n.datum);
      if (!p) return n.datum;
      var rok = parseInt(p[1], 10);
      var mesic = parseInt(p[2], 10);
      var posledni = new Date(rok, mesic, 0).getDate();
      return p[1] + "-" + p[2] + "-" + (posledni < 10 ? "0" : "") + posledni;
    }
    return n.datum;
  }

  // Kolik kalendářních měsíců je od letošního měsíce k měsíci návštěvy
  // (0 = tento měsíc). Pro orientační termíny, kde den nic neznamená.
  function mesicuDoTerminu(n) {
    var p = /^(\d{4})-(\d{2})/.exec(String(n.datum || ""));
    if (!p) return null;
    var ted = new Date();
    return (parseInt(p[1], 10) * 12 + parseInt(p[2], 10)) - (ted.getFullYear() * 12 + ted.getMonth() + 1);
  }

  // Nejbližší nadcházející návštěva (nezrušená, neproběhlá, s termínem, který
  // ještě neskončil) — dostane velkou kartu „Příště“. `serazene` je podle data.
  function nejblizsiNavsteva(serazene, dnes) {
    for (var i = 0; i < serazene.length; i++) {
      var n = serazene[i];
      if (n.datum && konecTerminuIso(n) >= dnes && !jeDokoncena(n)) return n;
    }
    return null;
  }

  // Počet komentářů a poslední komentář ke každé návštěvě (z aktivita.json).
  function indexKomentaru(aktivita) {
    var pocet = Object.create(null);
    var posledni = Object.create(null);
    (aktivita || []).forEach(function (a) {
      if (a.smazano || a.druh !== "komentar" || a.entita !== "navsteva" || !a.entita_id) return;
      pocet[a.entita_id] = (pocet[a.entita_id] || 0) + 1;
      var p = posledni[a.entita_id];
      if (!p || String(a.kdy) > String(p.kdy)) posledni[a.entita_id] = a;
    });
    return { pocet: pocet, posledni: posledni };
  }

  // ---- formáty data pro kompaktní seznam ----

  var MESICE_NOM = [
    "leden", "únor", "březen", "duben", "květen", "červen",
    "červenec", "srpen", "září", "říjen", "listopad", "prosinec"
  ];
  var MESICE_GEN = [
    "ledna", "února", "března", "dubna", "května", "června",
    "července", "srpna", "září", "října", "listopadu", "prosince"
  ];

  function rozdelIso(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return null;
    return { rok: parseInt(m[1], 10), mesic: parseInt(m[2], 10), den: parseInt(m[3], 10) };
  }

  // Přesné datum? (Návštěva bez data se bere jako „orientační“ — nic nevíme.)
  function jePresne(n) {
    return !!n.datum && (n.datum_presnost || "presne") === "presne";
  }

  // Velké datum v kartě „Příště“: „15. října“ (u jiného roku než letošního
  // i s rokem), u měsíční/obdobní přesnosti „říjen 2026“ (resp. rozsah).
  function datumVelke(n) {
    var p = rozdelIso(n.datum);
    if (!p) return "datum neurčeno";
    if ((n.datum_presnost || "presne") === "presne") {
      var text = p.den + ". " + MESICE_GEN[p.mesic - 1];
      if (p.rok !== new Date().getFullYear()) text += " " + p.rok;
      return text;
    }
    return formatDatumNavstevy(n);
  }

  // Krátké datum do sloupce řádku: „1. 12.“ nebo (orientačně) „prosinec“.
  function datumKratke(n) {
    var p = rozdelIso(n.datum);
    if (!p) return "—";
    if ((n.datum_presnost || "presne") === "presne") return p.den + ". " + p.mesic + ".";
    return MESICE_NOM[p.mesic - 1];
  }

  var MESICE_ZKR = ["led", "úno", "bře", "dub", "kvě", "čvn", "čvc", "srp", "zář", "říj", "lis", "pro"];

  // Měsíc v rámečku jako lísteček z kalendáře. Přesné datum = plný rámeček
  // s dnem, orientační termín = čárkovaný rámeček jen s měsícem.
  function htmlDlazdice(n) {
    var p = rozdelIso(n.datum);
    var titulek = n.datum ? formatDatumNavstevy(n) + (jePresne(n) ? "" : " (orientačně)") : "datum neurčeno";
    if (!p) {
      return '<span class="nv-dlazdice nv-dlazdice-orientacni" title="' + esc(titulek) + '">' +
        '<span class="nv-dlazdice-mesic">—</span><span class="nv-dlazdice-den">?</span></span>';
    }
    if (!jePresne(n)) {
      return '<span class="nv-dlazdice nv-dlazdice-orientacni" title="' + esc(titulek) + '">' +
        '<span class="nv-dlazdice-mesic">' + esc(MESICE_ZKR[p.mesic - 1]) + "</span></span>";
    }
    return '<span class="nv-dlazdice" title="' + esc(titulek) + '">' +
      '<span class="nv-dlazdice-mesic">' + esc(MESICE_ZKR[p.mesic - 1]) + "</span>" +
      '<span class="nv-dlazdice-den">' + p.den + "</span></span>";
  }

  // „za 7 dní“ / „za 2 měs.“ / „za 1 rok“ (a „před …“ pro zpožděné návštěvy).
  function textZa(n) {
    if (!n.datum) return "";
    if (!jePresne(n)) {
      var m = mesicuDoTerminu(n);
      if (m === null) return "";
      if (m === 0) return "tento měsíc";
      if (m === 1) return "příští měsíc";
      if (m === -1) return "minulý měsíc";
      var absM = Math.abs(m);
      if (absM < 12) return (m > 0 ? "za " : "před ") + absM + " měs.";
      var r = Math.round(absM / 12);
      return m > 0 ? "za " + r + " " + tvarCisla(r, "rok", "roky", "let") : "před " + r + " " + (r === 1 ? "rokem" : "lety");
    }
    var dni = Util.zaDni(n.datum);
    if (typeof dni !== "number" || isNaN(dni)) return "";
    if (dni === 0) return "dnes";
    var budouci = dni > 0;
    var abs = Math.abs(dni);
    var predpona = budouci ? "za " : "před ";
    if (abs === 1) return budouci ? "zítra" : "včera";
    if (abs < 31) {
      return predpona + abs + " " + (budouci ? tvarCisla(abs, "den", "dny", "dní") : "dny");
    }
    var mesicu = Math.max(1, Math.round(abs / 30.44));
    if (abs < 365 && mesicu < 12) return predpona + mesicu + " měs.";
    var roku = Math.max(1, Math.round(abs / 365.25));
    if (budouci) return "za " + roku + " " + tvarCisla(roku, "rok", "roky", "let");
    return "před " + roku + " " + (roku === 1 ? "rokem" : "lety");
  }

  function zkrat(text, max) {
    var t = String(text || "").replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    return t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
  }

  // ---- ikony typů (jednoduché linkové SVG 16×16, barva dle currentColor) ----

  function svg(vnitrek) {
    return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      vnitrek + "</svg>";
  }

  var IKONY = {
    // fotoaparát
    foto: svg('<path d="M2 5.5h2.2l1.1-1.7h5.4l1.1 1.7H14a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-.5.5H2a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5z"/>' +
      '<circle cx="8" cy="9" r="2.4"/>'),
    // dron: kříž se čtyřmi kroužky
    dron: svg('<circle cx="3.2" cy="3.2" r="1.7"/><circle cx="12.8" cy="3.2" r="1.7"/>' +
      '<circle cx="3.2" cy="12.8" r="1.7"/><circle cx="12.8" cy="12.8" r="1.7"/>' +
      '<path d="M4.4 4.4 6.8 6.8M11.6 4.4 9.2 6.8M4.4 11.6 6.8 9.2M11.6 11.6 9.2 9.2"/>' +
      '<rect x="6.6" y="6.6" width="2.8" height="2.8" rx=".6"/>'),
    // videokamera
    rucni: svg('<rect x="1.5" y="4.5" width="9" height="7" rx="1.2"/><path d="M10.5 7.2 14.5 5v6l-4-2.2z"/>'),
    // klíč
    "casosber-servis": svg('<circle cx="5" cy="11" r="2.8"/><path d="M7 9l6.5-6.5M11 4.5l1.8 1.8M9.3 6.2l1.4 1.4"/>'),
    // mikrofon (typ „rozhovor“)
    rozhovor: svg('<rect x="6" y="1.8" width="4" height="7" rx="2"/><path d="M3.8 7.5a4.2 4.2 0 0 0 8.4 0M8 11.7v2.5M5.5 14.2h5"/>')
  };

  function htmlIkony(typy) {
    var html = '<span class="nv-ikony">';
    TYP_PORADI.forEach(function (t) {
      if (!IKONY[t] || (typy || []).indexOf(t) === -1) return;
      var nazev = esc(TYP_LABEL[t] || t);
      html += '<span class="nv-ikona nv-ikona-' + esc(t) + '" role="img" title="' + nazev +
        '" aria-label="' + nazev + '">' + IKONY[t] + "</span>";
    });
    return html + "</span>";
  }

  function htmlStavChip(stav) {
    return '<span class="nv-stav nv-stav-' + esc(stav) + '">' + esc(stavInfo(stav).nazev) + "</span>";
  }

  // Co se od nás u návštěvy chce — jeden krok schvalovacího kolečka (§6).
  // `bezLimitu` = bez omezení „návrh do 45 dní“ (karta „Příště“).
  function krokCekani(n, prava, dnes, bezLimitu) {
    if (n.stav === "ke-schvaleni" && prava.schvalit) {
      return { veta: "Schválit termín a plán", text: "Schválit", akce: "stav-schvalit" };
    }
    if (n.stav === "schvaleno" && prava.upravit) {
      return { veta: "Potvrdit termín", text: "Potvrdit", akce: "stav-potvrdit" };
    }
    if (n.stav === "potvrzeno" && prava.upravit && n.datum && konecTerminuIso(n) < dnes) {
      return { veta: "Proběhlo? Označ to", text: "Proběhlo", akce: "stav-probehlo" };
    }
    if (n.stav === "navrh" && prava.upravit && n.datum && (bezLimitu || Util.zaDni(n.datum) <= 45)) {
      return { veta: "Poslat ke schválení", text: "Odeslat", akce: "stav-odeslat" };
    }
    return null;
  }

  // ---- odpočet k termínu ----

  function tvarCisla(pocet, jeden, dva, vic) {
    if (pocet === 1) return jeden;
    if (pocet >= 2 && pocet <= 4) return dva;
    return vic;
  }

  // Velké číslo u termínu: do měsíce dny, do roku měsíce, dál roky s jedním
  // desetinným místem. Co je za námi, je tlumené a má u jednotky „zpět".
  function htmlOdpocet(n) {
    if (!n.datum) return "";
    if (!jePresne(n)) {
      var m = mesicuDoTerminu(n);
      if (m === null) return "";
      var minulyM = m < 0;
      var absM = Math.abs(m);
      var cisloM = absM === 0 ? "tento" : String(absM);
      var jednotkaM = absM === 0 ? "měsíc" : tvarCisla(absM, "měsíc", "měsíce", "měsíců") + (minulyM ? " zpět" : "");
      return '<span class="navsteva-odpocet' + (minulyM ? " navsteva-odpocet-minulost" : "") +
        '" title="Termín je zatím jen orientační"><strong>' + esc(cisloM) + "</strong>" +
        '<span class="navsteva-odpocet-jednotka">' + esc(jednotkaM) + "</span></span>";
    }
    var dni = Util.zaDni(n.datum);
    if (typeof dni !== "number" || isNaN(dni)) return "";
    var minulost = dni < 0;
    var abs = Math.abs(dni);
    var cislo;
    var jednotka;
    if (abs === 0) {
      cislo = "dnes";
      jednotka = "";
    } else if (abs < 31) {
      cislo = abs;
      jednotka = tvarCisla(abs, "den", "dny", "dní");
    } else if (abs < 365) {
      var mesicu = Math.round(abs / 30.44);
      cislo = mesicu;
      jednotka = tvarCisla(mesicu, "měsíc", "měsíce", "měsíců");
    } else {
      var roky = Math.round((abs / 365.25) * 10) / 10;
      var cele = roky === Math.round(roky);
      cislo = String(roky).replace(".", ",");
      jednotka = cele ? tvarCisla(roky, "rok", "roky", "let") : "roku";
    }
    var popis = abs === 0
      ? "Termín je dnes"
      : (minulost ? "Bylo před " : "Zbývá ") + cislo + " " + jednotka;
    if (jednotka && minulost) jednotka += " zpět";
    return '<span class="navsteva-odpocet' + (minulost ? " navsteva-odpocet-minulost" : "") +
      '" title="' + esc(popis) + '"><strong>' + esc(String(cislo)) + "</strong>" +
      (jednotka ? '<span class="navsteva-odpocet-jednotka">' + esc(jednotka) + "</span>" : "") +
      "</span>";
  }

  // ---- seznam: hlavička, „Čeká na vás“, „Příště“, „Plán“, „Proběhlo“ ----

  function htmlHlava(prava, maNavrhy) {
    var html = '<header class="nv-hlava"><h2>Návštěvy</h2><div class="nv-hlava-akce">';
    if (prava.pridat) {
      html += '<button type="button" class="btn btn-primarni btn-mala" data-nav-akce="pridat">+ Návštěva</button>';
    }
    html += '<div class="nv-menu"><button type="button" class="nv-menu-btn" data-nav-akce="menu" ' +
      'aria-haspopup="true" aria-expanded="false" aria-label="Další akce">⋯</button>' +
      '<div class="nv-menu-seznam" hidden>' +
      '<button type="button" data-nav-akce="kopirovat-plan">Kopírovat plán jako text</button>';
    if (prava.upravit && maNavrhy) {
      html += '<button type="button" data-nav-akce="odeslat-vse">Odeslat celý návrh ke schválení</button>';
    }
    html += "</div></div></div></header>";
    return html;
  }

  function htmlCeka(serazene, prava, dnes) {
    var polozky = [];
    serazene.forEach(function (n) {
      var krok = krokCekani(n, prava, dnes, false);
      if (krok) polozky.push({ n: n, krok: krok });
    });
    if (!polozky.length) return "";

    var html = '<section class="nv-ceka" aria-label="Čeká na vás"><h3 class="nv-nadpis">Čeká na vás ' +
      '<span class="nv-pocet">' + polozky.length + "</span></h3>";
    polozky.slice(0, 5).forEach(function (p) {
      var n = p.n;
      html += '<div class="nv-ceka-polozka" data-id="' + esc(n.id) + '">' +
        '<div class="nv-ceka-text"><span class="nv-cislo">#' + esc(n.cislo) + "</span> " +
        '<span class="nv-ceka-nazev">' + esc(n.nazev) + "</span> " +
        '<span class="nv-ceka-datum" title="' + esc(n.datum ? formatDatumNavstevy(n) : "datum neurčeno") + '">' +
        esc(datumKratke(n)) + "</span>" +
        '<span class="nv-ceka-veta">' + esc(p.krok.veta) + "</span></div>" +
        '<button type="button" class="btn btn-primarni btn-mala" data-nav-akce="' + esc(p.krok.akce) + '">' +
        esc(p.krok.text) + "</button></div>";
    });
    return html + "</section>";
  }

  function htmlPristi(n, lide, prava, dnes, ind) {
    var cas = formatCasRozsah(n);
    var html = '<section class="nv-pristi" data-id="' + esc(n.id) + '" aria-label="Příští návštěva">';
    html += '<div class="nv-pristi-stitek">Příště</div>';

    html += '<div class="nv-pristi-hlava"><div class="nv-pristi-datum' + (jePresne(n) ? "" : " nv-orientacne") + '">' +
      esc(datumVelke(n)) + (cas ? '<span class="nv-pristi-cas">' + esc(cas) + "</span>" : "") + "</div>" +
      htmlOdpocet(n) + "</div>";

    html += '<div class="nv-pristi-nazev"><span class="nv-cislo">#' + esc(n.cislo) + "</span> " + esc(n.nazev) + "</div>";

    html += '<div class="nv-pristi-meta">' + htmlStavChip(n.stav) + " " + htmlIkony(n.typ) +
      ' <span class="nv-lide">Za stavbu: ' + htmlZaStavbu(n, lide, true) +
      " · Za nás: " + esc(jmenaOsobPodleId(n.za_nas, lide)) + "</span></div>";

    var body = n.co_se_toci || [];
    if (body.length) {
      html += '<div class="nv-pristi-podnadpis">Co se natočí</div><ul class="nv-body" aria-label="Co se natočí">';
      body.forEach(function (p) {
        html += '<li><label class="nv-bod"><input type="checkbox" name="shot-karta" data-polozka="' + esc(p.id) + '"' +
          (p.hotovo ? " checked" : "") + (prava.body ? "" : " disabled") + "><span>" + esc(p.text) + "</span></label></li>";
      });
      html += "</ul>";
    }

    var posledni = ind.posledni[n.id];
    if (posledni) {
      var dalsich = (ind.pocet[n.id] || 1) - 1;
      html += '<div class="nv-pristi-komentar"><strong>' + esc(jmenoAutora(posledni.kdo, lide)) + "</strong> " +
        esc(zkrat(posledni.text, 160)) +
        (dalsich > 0 ? ' <span class="nv-pristi-komentar-pocet">a další ' + dalsich + "</span>" : "") + "</div>";
    }

    var smiKomentovat = !!(window.Auth && Auth.can && Auth.can("komentare.pridat"));
    var krok = krokCekani(n, prava, dnes, true);
    html += '<div class="nv-pristi-akce">';
    if (krok) {
      html += '<button type="button" class="btn btn-primarni btn-mala" data-nav-akce="' + esc(krok.akce) + '">' +
        esc(krok.text) + "</button>";
    }
    if (smiKomentovat && !komentarVPristi) {
      html += '<button type="button" class="btn btn-sekundarni btn-mala" data-nav-akce="pristi-komentar">Komentář</button>';
    }
    html += '<button type="button" class="btn btn-tiche btn-mala" data-nav-akce="otevrit">Otevřít</button></div>';

    // Formulář komentáře přímo v kartě — bez prokliku do panelu.
    if (smiKomentovat && komentarVPristi) {
      html += '<form class="nv-pristi-form" data-nav-akce-form="pristi-komentar">' +
        '<textarea name="text" rows="2" required placeholder="Napište komentář…" aria-label="Komentář k návštěvě">' +
        esc(komentarVPristiText) + "</textarea>" +
        "<div data-zminky-misto></div>" +
        '<div class="nv-pristi-form-akce"><button type="submit" class="btn btn-primarni btn-mala">Odeslat</button>' +
        '<button type="button" class="btn btn-tiche btn-mala" data-nav-akce="pristi-komentar-zrusit">Zrušit</button></div>' +
        "</form>";
    }

    return html + "</section>";
  }

  // Řádek tabulky: rámeček s měsícem | název | (typ, komentáře, kdy, stav).
  // Druhá část je v obalu .nv-radek-meta — na počítači se rozpadne do sloupců
  // tabulky (display: contents), na mobilu z něj je druhý řádek pod názvem.
  function htmlRadek(n, ind) {
    var html = '<li class="nv-radek nv-stav-' + esc(n.stav) + '" data-id="' + esc(n.id) + '" tabindex="0" role="button" ' +
      'aria-label="Otevřít návštěvu č. ' + esc(n.cislo) + " " + esc(n.nazev) + '">';
    html += htmlDlazdice(n);
    html += '<span class="nv-radek-nazev"><span class="nv-cislo">#' + esc(n.cislo) + "</span> " + esc(n.nazev) + "</span>";
    html += '<span class="nv-radek-meta">' + htmlIkony(n.typ);
    var komentaru = ind.pocet[n.id] || 0;
    html += komentaru > 0
      ? '<span class="nv-bublina" title="Komentáře">' + komentaru + "</span>"
      : '<span class="nv-bublina nv-bublina-prazdna" aria-hidden="true"></span>';
    html += '<span class="nv-za">' + esc(textZa(n)) + "</span>";
    html += htmlStavChip(n.stav) + "</span>";
    return html + "</li>";
  }

  function tvarNavstev(pocet) {
    return pocet + " " + tvarCisla(pocet, "návštěva", "návštěvy", "návštěv");
  }

  // Záhlaví sloupců — jen vizuální, každý řádek má vlastní aria-label.
  function htmlZahlaviTabulky() {
    return '<div class="nv-tabulka-hlava" aria-hidden="true"><span>Termín</span><span>Návštěva</span>' +
      "<span>Typ</span><span></span><span>Kdy</span><span>Stav</span></div>";
  }

  function htmlPlan(zbyle, ind) {
    if (!zbyle.length) return "";
    var html = '<section class="nv-plan" aria-label="Plán"><div class="nv-tabulka">' + htmlZahlaviTabulky();
    // Každý rok ve vlastní skupině — lepivý nadpis roku pak drží jen nad
    // svými návštěvami a s nimi i odjede, místo aby visel nad cizími.
    skupinyPodleRoku(zbyle).forEach(function (skupina) {
      html += '<div class="nv-skupina"><h3 class="nv-rok"><span>' + esc(skupina.nadpis) + "</span>" +
        '<span class="nv-rok-pocet">' + esc(tvarNavstev(skupina.polozky.length)) + '</span></h3><ol class="nv-seznam">';
      skupina.polozky.forEach(function (n) {
        html += htmlRadek(n, ind);
      });
      html += "</ol></div>";
    });
    return html + "</div></section>";
  }

  function htmlProbehlo(hotove, ind) {
    if (!hotove.length) return "";
    var html = '<details class="nv-probehlo"' + (probehloOtevrene ? " open" : "") + ">" +
      '<summary>Proběhlo <span class="nv-pocet">' + hotove.length + '</span></summary>' +
      '<div class="nv-tabulka"><ol class="nv-seznam">';
    hotove.forEach(function (n) { html += htmlRadek(n, ind); });
    return html + "</ol></div></details>";
  }

  // ---- vykreslení sekce ----

  // Náš tým = superadmin nebo osoba ze strany FD. Stavba (PORR, Metrostav)
  // dostane klidnější pohled: plánování, termíny a mazání se jí neukazují.
  // Práva (Auth.can) se tím nemění — jde jen o to, co se ukáže (Franta
  // 8. 10. 2026: „na ty stavitele je to moc složité").
  function jeNasTym() {
    return !!(window.Auth && (Auth.role === "superadmin" ||
      (window.App && typeof App.jsemZaFD === "function" && App.jsemZaFD())));
  }

  function zjistiPrava() {
    function can(kod) {
      return !!(window.Auth && Auth.can && Auth.can(kod));
    }
    var nas = jeNasTym();
    return {
      pridat: can("navstevy.pridat") && nas,
      // `upravit` = plánovat (stav, termín) — jen náš tým
      upravit: can("navstevy.upravit") && nas,
      // `body` = odškrtnout a přidat „Co se natočí" — smí i stavba s právem upravit
      body: can("navstevy.upravit"),
      schvalit: can("navstevy.schvalit"),
      mazat: can("navstevy.smazat") && nas
    };
  }

  function vykresli(kontejner) {
    var cil = kontejner || document.getElementById("obsah");
    if (!cil) return;
    cil.dataset.aktivniSekce = "navstevy";
    posledniKontejner = cil;

    var lide = polozkyZeSouboru("lide");
    var aktivita = polozkyZeSouboru("aktivita");
    var prava = zjistiPrava();
    var dnes = dnesniIso();
    var zive = ziveNavstevy().slice().sort(porovnejNavstevy);
    var ind = indexKomentaru(aktivita);

    var pristi = nejblizsiNavsteva(zive, dnes);
    var maNavrhy = zive.some(function (n) { return n.stav === "navrh"; });
    var zbyle = zive.filter(function (n) {
      return !jeDokoncena(n) && !(pristi && n.id === pristi.id);
    });
    var hotove = zive.filter(jeDokoncena).sort(porovnejSestupne);

    var html = '<div class="nv">' + htmlHlava(prava, maNavrhy);
    if (!zive.length) {
      html += '<div class="prazdny-stav"><span class="prazdny-stav-ikona" aria-hidden="true"></span>' +
        '<p class="prazdny-stav-text">Zatím tu nejsou žádné návštěvy' +
        (prava.pridat ? " — přidejte první tlačítkem „+ Návštěva“." : ".") + "</p></div>";
    } else {
      html += htmlCeka(zive.filter(function (n) { return !pristi || n.id !== pristi.id; }), prava, dnes);
      if (pristi) html += htmlPristi(pristi, lide, prava, dnes, ind);
      html += htmlPlan(zbyle, ind);
      html += htmlProbehlo(hotove, ind);
    }
    html += "</div>";

    cil.innerHTML = html;
    napojPosluchace(cil);
    otevriZHashe();
    if (komentarVPristi) {
      var formular = cil.querySelector(".nv-pristi-form");
      // Panel má vlastní výběr lidí; tady jen když panel zrovna není otevřený.
      if (formular && !idOtevrenehoDetailu) dopluVyberZminek(formular);
    }
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

  // ---- vlastní jednoduchý dialog (boční panel), základ jako ve view-lide.js ----

  function otevriModal(nadpis, obsahUzel) {
    var dlg = document.createElement("dialog");
    dlg.className = "modal-okno nv-panel";

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

  // Odkaz „#navstevy/<id>“ (z Přehledu, z Plánu stavby) otevře rovnou detail
  // té návštěvy. Hash se hned vrátí na „#navstevy“ (replaceState hashchange
  // nevyvolá), ať se panel neotvírá znovu při každém obnovení dat.
  function otevriZHashe() {
    var id = window.App && typeof App.parametrHashe === "function" ? App.parametrHashe() : "";
    if (!id) return;
    try { history.replaceState(null, "", "#navstevy"); } catch (e) { /* bez history API necháme hash být */ }
    if (idOtevrenehoDetailu || !najdiPodleId(polozkyZeSouboru("navstevy"), id)) return;
    setTimeout(function () { otevriDetail(id); }, 0);
  }

  // ---- stavba HTML detailu (boční panel) ----

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

  // Termín a čas se upravují přímo v panelu (sekce „Termín“) a ukládají se
  // hned po každé změně pole (viz change posluchač v napojPosluchaceDetail).
  // Ostatním se jen vypíše text data a času.
  function htmlTerminPanel(n, smiUpravit) {
    var info = stavInfo(n.stav);
    var presnost = n.datum_presnost || "presne";

    if (!smiUpravit) {
      var jeOrientacni = !!n.datum && (info.orientacne || presnost === "mesic" || presnost === "obdobi");
      var casText = formatCasRozsah(n);
      return '<p class="karta-meta">' + esc(n.datum ? formatDatumNavstevy(n) : "datum neurčeno") +
        (casText ? " · " + esc(casText) : "") + (jeOrientacni ? " · orientačně" : "") + "</p>";
    }

    var id = esc(n.id);
    var html = '<div class="formular" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0 12px">';

    html += '<div class="pole"><label for="itd-' + id + '">Datum</label>' +
      '<input id="itd-' + id + '" name="inline-datum" type="date" value="' + esc(n.datum || "") + '"></div>';

    html += '<div class="pole"><label for="itp-' + id + '">Přesnost</label>' +
      '<select id="itp-' + id + '" name="inline-presnost">';
    PRESNOSTI.forEach(function (p) {
      html += '<option value="' + p[0] + '"' + (presnost === p[0] ? " selected" : "") + ">" + esc(p[1]) + "</option>";
    });
    html += "</select></div>";

    if (presnost === "obdobi") {
      html += '<div class="pole"><label for="itdd-' + id + '">Období do</label>' +
        '<input id="itdd-' + id + '" name="inline-datum-do" type="date" value="' + esc(n.datum_do || "") + '"></div>';
    }

    html += '<div class="pole"><label for="itco-' + id + '">Čas od</label>' +
      '<input id="itco-' + id + '" name="inline-cas-od" type="time" value="' + esc(n.cas_od || "") + '"></div>';
    html += '<div class="pole"><label for="itcd-' + id + '">Čas do</label>' +
      '<input id="itcd-' + id + '" name="inline-cas-do" type="time" value="' + esc(n.cas_do || "") + '"></div>';

    html += "</div>";
    html += '<p class="karta-meta">Každá změna se uloží hned.</p>';
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

  // `bezNadpisu` (boční panel): nadpis „Co se natočí“ dodá sekce panelu.
  function htmlShotList(n, smiUpravit, bezNadpisu) {
    var polozky = n.co_se_toci || [];
    var html = '<div class="oddil">' +
      (bezNadpisu ? "" : '<h3 class="nadpis-sekce" style="font-size:1rem">Co se natočí</h3>');
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
        '<input type="text" name="text" placeholder="Další záběr…" required ' +
        'style="flex:1 1 auto;background:var(--panel-2);border:1px solid var(--linka);color:var(--text);border-radius:2px;padding:10px 12px;min-height:44px">' +
        '<button type="submit" class="btn btn-sekundarni">Přidat</button></form>';
    }
    html += "</div>";
    return html;
  }

  // `kompaktne` (boční panel): bez nadpisu „Schvalování“ a řádku „Aktuální
  // stav“ — stav je nahoře v panelu jako chip hned vedle tlačítek.
  function htmlSchvalovani(n, smiSchvalit, smiUpravit, lide, kompaktne) {
    var html = '<div class="oddil">';
    if (!kompaktne) {
      html += '<h3 class="nadpis-sekce" style="font-size:1rem">Schvalování</h3>';
      html += '<p class="karta-meta">Aktuální stav: <span class="stitek nav-stav-' + esc(n.stav) + '">' +
        esc(stavNazev(n.stav)) + "</span></p>";
    }

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

  // `bezNadpisu` (boční panel): nadpis „Komentáře“ dodá sekce panelu.
  function htmlKomentare(n, aktivita, lide, smiKomentovat, smiMazatCizi, bezNadpisu) {
    var mojeId = (window.Auth && Auth.ja && Auth.ja.id) || null;
    var seznam = aktivita.filter(function (a) {
      return !a.smazano && a.druh === "komentar" && a.entita === "navsteva" && a.entita_id === n.id;
    }).slice().sort(function (a, b) { return String(b.kdy).localeCompare(String(a.kdy)); });

    var html = '<div class="oddil">' +
      (bezNadpisu ? "" : '<h3 class="nadpis-sekce" style="font-size:1rem">Komentáře</h3>');
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

  // Boční panel: nahoře stav + schvalovací tlačítka (nejdůležitější), pak
  // Termín, Co se natočí, Komentáře, Podrobnosti a nebezpečná zóna.
  function htmlDetail(n) {
    var plan = polozkyZeSouboru("plan");
    var lide = polozkyZeSouboru("lide");
    var aktivita = polozkyZeSouboru("aktivita");
    var prava = zjistiPrava();
    var smiUpravit = prava.upravit;          // termín, stav, podrobnosti — náš tým
    var smiBody = prava.body;                // „Co se natočí" — i stavba
    var smiSchvalit = prava.schvalit;
    var smiMazat = prava.mazat;
    var smiKomentovat = !!(window.Auth && Auth.can && Auth.can("komentare.pridat"));
    var smiMazatCizi = !!(window.Auth && Auth.can && Auth.can("komentare.smazat.cizi"));
    var upravujeSe = smiUpravit && detailUpravy;

    var html = '<div class="nv-panel-akce">' + htmlStavChip(n.stav) +
      htmlSchvalovani(n, smiSchvalit, smiUpravit, lide, true) + "</div>";

    html += '<section class="nv-panel-sekce"><h3>Termín</h3>' + htmlTerminPanel(n, smiUpravit) + "</section>";

    html += '<section class="nv-panel-sekce"><h3>Co se natočí</h3>' + htmlShotList(n, smiBody, true) + "</section>";

    html += '<section class="nv-panel-sekce"><h3>Komentáře</h3>' +
      htmlKomentare(n, aktivita, lide, smiKomentovat, smiMazatCizi, true) + "</section>";

    html += '<section class="nv-panel-sekce"><h3>Podrobnosti</h3>';
    html += upravujeSe ? htmlFormularEditace(n, plan, lide) : htmlDetailCteni(n, plan, lide);
    if (zminujeCasosber(n.poznamka)) {
      html += '<p class="karta-meta"><a href="#casosber" data-nav-akce="zavrit-panel">→ Časosběr</a></p>';
    }
    if (smiUpravit) {
      html += '<div class="karta-akce"><button type="button" id="nd-upravit-detaily" class="btn btn-tiche btn-mala" ' +
        'data-nav-akce="upravit-detaily" aria-expanded="' + (upravujeSe ? "true" : "false") + '">' +
        (upravujeSe ? "Zrušit úpravy" : "Upravit") + "</button></div>";
    }
    html += "</section>";

    html += htmlNebezpecnaZona(n, smiMazat);
    return html;
  }

  // ---- panel — otevření / překreslení ----

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

  function nadpisPanelu(n) {
    return "#" + n.cislo + " " + n.nazev;
  }

  function otevriDetail(id) {
    var n = najdiPodleId(polozkyZeSouboru("navstevy"), id);
    if (!n) return;
    idOtevrenehoDetailu = id;
    detailUpravy = false;

    modalObsahUzel = document.createElement("div");
    napojPosluchaceDetail(modalObsahUzel);
    modalObsahUzel.innerHTML = htmlDetail(n);
    dopluVyberZminek(modalObsahUzel);

    modalRef = otevriModal(nadpisPanelu(n), modalObsahUzel);
    modalRef.dlg.addEventListener("close", function () {
      idOtevrenehoDetailu = null;
      modalObsahUzel = null;
      modalRef = null;
      vyberZminekKomentare = null;
      detailUpravy = false;
    });
  }

  function prekresliDetail() {
    if (!idOtevrenehoDetailu || !modalObsahUzel) return;
    var n = najdiPodleId(polozkyZeSouboru("navstevy"), idOtevrenehoDetailu);
    if (!n) {
      if (modalRef) modalRef.zavri();
      return;
    }
    // Termín se ukládá po každé změně pole a panel se kvůli tomu překreslí —
    // fokus se proto vrací na stejný prvek (pole mají id), ať se dá
    // klávesnicí plynule pokračovat.
    var aktivni = document.activeElement;
    var aktivniId = aktivni && aktivni.id && modalObsahUzel.contains(aktivni) ? aktivni.id : null;

    modalObsahUzel.innerHTML = htmlDetail(n);
    dopluVyberZminek(modalObsahUzel);

    if (modalRef && modalRef.dlg) {
      var h = modalRef.dlg.querySelector(".modal-nadpis");
      if (h) h.textContent = nadpisPanelu(n);
    }
    if (aktivniId) {
      var el = document.getElementById(aktivniId);
      if (el && modalObsahUzel.contains(el) && typeof el.focus === "function") {
        try {
          el.focus({ preventScroll: true });
        } catch (chyba) {
          el.focus();
        }
      }
    }
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
    transakce(id, function (n) {
      n.stav = "potvrzeno";
      // Potvrzený termín je přesný den — orientační „říjen“ už neplatí.
      if (n.datum) { n.datum_presnost = "presne"; n.datum_do = null; }
    }, "Potvrzen termín — návštěva č. " + cisloNavstevy(id))
      .then(poUspechuNavstevy).catch(poChybe);
  }

  function oznacitProbehlo(id) {
    transakce(id, function (n) { n.stav = "probehlo"; }, "Označeno jako proběhlé — návštěva č. " + cisloNavstevy(id))
      .then(poUspechuNavstevy).catch(poChybe);
  }

  function vratitDoNavrhu(id, poznamkaText) {
    var cislo = cisloNavstevy(id);
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
    }, "Přidán bod „Co se natočí“ — návštěva č. " + cisloNavstevy(id)).then(poUspechuNavstevy).catch(poChybe);
  }

  function shotPrepnout(id, polozkaId) {
    transakce(id, function (n) {
      var p = (n.co_se_toci || []).find(function (x) { return x.id === polozkaId; });
      if (p) p.hotovo = !p.hotovo;
    }, "Upraveno „Co se natočí“ — návštěva č. " + cisloNavstevy(id)).then(poUspechuNavstevy).catch(poChybe);
  }

  function shotSmazat(id, polozkaId) {
    transakce(id, function (n) {
      n.co_se_toci = (n.co_se_toci || []).filter(function (x) { return x.id !== polozkaId; });
    }, "Smazán bod „Co se natočí“ — návštěva č. " + cisloNavstevy(id)).then(poUspechuNavstevy).catch(poChybe);
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

  // Formulář úprav (sekce „Podrobnosti“) NEobsahuje datum/přesnost/čas — ta pole
  // se editují zvlášť v sekci „Termín“ panelu, takže se tu ani nesmí přepisovat
  // (jinak by se vynulovala).
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
        // Panel po uložení zůstane otevřený a ukáže uložené podrobnosti —
        // zavřít ho je zbytečný krok navíc, když člověk chce pokračovat.
        detailUpravy = false;
        prekresliDetail();
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

  // Menu ⋯ v hlavičce — otevření/zavření (hidden + aria-expanded).
  function zavriMenu(vratitFokus) {
    if (!posledniKontejner) return;
    var seznam = posledniKontejner.querySelector(".nv-menu-seznam");
    var tlacitko = posledniKontejner.querySelector(".nv-menu-btn");
    if (seznam) seznam.hidden = true;
    if (tlacitko) {
      tlacitko.setAttribute("aria-expanded", "false");
      if (vratitFokus) tlacitko.focus();
    }
  }

  function prepniMenu(tlacitko) {
    var menu = tlacitko.closest(".nv-menu");
    var seznam = menu ? menu.querySelector(".nv-menu-seznam") : null;
    if (!seznam) return;
    var otevrit = seznam.hidden;
    seznam.hidden = !otevrit;
    tlacitko.setAttribute("aria-expanded", otevrit ? "true" : "false");
  }

  // Klik mimo menu a Esc ho zavřou. Posluchače jsou na dokumentu (menu se
  // při každém překreslení vytváří znovu), proto se věší jen jednou.
  function napojMenuNaDokument() {
    if (menuNapojeno) return;
    menuNapojeno = true;
    document.addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest(".nv-menu")) return;
      zavriMenu(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" && e.key !== "Esc") return;
      var seznam = posledniKontejner ? posledniKontejner.querySelector(".nv-menu-seznam") : null;
      if (!seznam || seznam.hidden) return;
      zavriMenu(true);
    });
  }

  function napojPosluchace(cil) {
    napojMenuNaDokument();
    if (cil._navstevyNapojeno) return;
    cil._navstevyNapojeno = true;

    cil.addEventListener("click", function (e) {
      if (cil.dataset.aktivniSekce !== "navstevy") return;
      var prvek = e.target.closest("[data-nav-akce]");
      if (!prvek) {
        // Klik na řádek plánu, kartu „Příště“ nebo text v pruhu „Čeká na vás“
        // (mimo ovládací prvky) otevře detail v bočním panelu.
        var oblast = e.target.closest(".nv-radek, .nv-pristi, .nv-ceka-text");
        if (!oblast) return;
        if (e.target.closest("button, a, input, select, textarea, label, summary")) return;
        var idOblasti = idKarty(oblast);
        if (idOblasti) otevriDetail(idOblasti);
        return;
      }
      var akce = prvek.dataset.navAkce;

      if (akce === "menu") { prepniMenu(prvek); return; }
      // Po výběru položky se menu zavře (ještě před případným potvrzením).
      if (prvek.closest(".nv-menu-seznam")) zavriMenu(false);

      if (akce === "pridat") { pridatNavstevu(); return; }
      if (akce === "odeslat-vse") { odeslatVseKeSchvaleni(); return; }
      if (akce === "kopirovat-plan") { kopirovatPlan(); return; }

      var id = idKarty(prvek);
      if (!id) return;

      if (akce === "otevrit") {
        otevriDetail(id);
      } else if (akce === "pristi-komentar") {
        komentarVPristi = true;
        fokusPo = '.nv-pristi-form textarea';
        vykresli(posledniKontejner);
      } else if (akce === "pristi-komentar-zrusit") {
        komentarVPristi = false;
        komentarVPristiText = "";
        vykresli(posledniKontejner);
      } else if (akce === "stav-odeslat") {
        odeslatKeSchvaleni(id);
      } else if (akce === "stav-schvalit") {
        schvalit(id);
      } else if (akce === "stav-potvrdit") {
        potvrditTermin(id);
      } else if (akce === "stav-probehlo") {
        oznacitProbehlo(id);
      }
    });

    // Rozepsaný komentář na kartě „Příště“ si pamatujeme přes překreslení.
    cil.addEventListener("input", function (e) {
      if (cil.dataset.aktivniSekce !== "navstevy") return;
      if (e.target && e.target.closest && e.target.closest(".nv-pristi-form")) {
        komentarVPristiText = e.target.value || "";
      }
    });

    cil.addEventListener("submit", function (e) {
      if (cil.dataset.aktivniSekce !== "navstevy") return;
      var form = e.target;
      if (!form.matches || !form.matches('[data-nav-akce-form="pristi-komentar"]')) return;
      e.preventDefault();
      var id = idKarty(form);
      var pole = form.querySelector('[name="text"]');
      var text = pole ? pole.value.trim() : "";
      if (!id || !text) return;
      var oznaceni = vyberZminekKomentare ? vyberZminekKomentare.vybrane() : [];
      var tlacitko = form.querySelector('button[type="submit"]');
      if (tlacitko) tlacitko.disabled = true;
      pridatKomentarZaznam(id, text, oznaceni)
        .then(function () {
          komentarVPristi = false;
          komentarVPristiText = "";
          vykresli(posledniKontejner);
          toastBezpecne("Komentář přidán.", "ok");
        })
        .catch(function (chyba) {
          if (tlacitko) tlacitko.disabled = false;
          poChybe(chyba);
        });
    });

    // Enter / mezerník na řádku plánu = otevřít detail (řádek je role="button").
    cil.addEventListener("keydown", function (e) {
      if (cil.dataset.aktivniSekce !== "navstevy") return;
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      var radek = e.target;
      if (!radek || !radek.classList || !radek.classList.contains("nv-radek")) return;
      e.preventDefault();
      if (radek.dataset.id) otevriDetail(radek.dataset.id);
    });

    // Odškrtávání bodů „Co se natočí“ na kartě „Příště“ — ukládá se hned.
    cil.addEventListener("change", function (e) {
      if (cil.dataset.aktivniSekce !== "navstevy") return;
      var t = e.target;
      if (!t || t.name !== "shot-karta") return;
      var id = idKarty(t);
      if (!id || !najdiPodleId(polozkyZeSouboru("navstevy"), id)) return;
      var polozka = t.dataset.polozka;
      fokusPo = '[data-id="' + id + '"] [data-polozka="' + String(polozka).replace(/["\\]/g, "\\$&") + '"]';
      shotPrepnout(id, polozka);
    });

    // <details> „Proběhlo“ — "toggle" nebublá, proto zachytávání. Stav se drží
    // v modulu, ať se seznam po každém zápisu dat znovu nesbalí.
    cil.addEventListener("toggle", function (e) {
      if (cil.dataset.aktivniSekce !== "navstevy") return;
      var det = e.target;
      if (!det || !det.classList || !det.classList.contains("nv-probehlo")) return;
      probehloOtevrene = !!det.open;
    }, true);
  }

  // ---- posluchače v bočním panelu ----

  function napojPosluchaceDetail(obsahUzel) {
    obsahUzel.addEventListener("click", function (e) {
      var prvek = e.target.closest("[data-nav-akce]");
      if (!prvek) return;
      var akce = prvek.dataset.navAkce;
      var id = idOtevrenehoDetailu;
      if (!id) return;

      if (akce === "shot-smazat") {
        shotSmazat(id, prvek.dataset.polozka);
      } else if (akce === "upravit-detaily") {
        // Sekce „Podrobnosti“: přepíná čtení <-> formulář úprav.
        detailUpravy = !detailUpravy;
        prekresliDetail();
        if (detailUpravy) {
          var pole = obsahUzel.querySelector('[name="nazev"]');
          if (pole) pole.focus();
        }
      } else if (akce === "zavrit-panel") {
        // Odkaz „→ Časosběr“: panel se zavře, přechod na #casosber proběhne sám.
        if (modalRef) modalRef.zavri();
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
      var t = e.target;
      if (!t) return;
      if (t.matches && t.matches('[data-nav-akce="shot-prepnout"]')) {
        shotPrepnout(idOtevrenehoDetailu, t.dataset.polozka);
        return;
      }

      // Termín a čas v sekci „Termín“ — každá změna pole se ukládá hned.
      if (!t.name || t.name.indexOf("inline-") !== 0) return;
      var id = idOtevrenehoDetailu;
      var navsteva = najdiPodleId(polozkyZeSouboru("navstevy"), id);
      if (!navsteva) return;

      if (t.name === "inline-datum") {
        // Vybraný konkrétní den = přesný termín. Dřív zůstala přesnost
        // „období“ a karta dál ukazovala jen „říjen“ (Franta 8. 10. 2026).
        ulozTermin(id, t.value ? { datum: t.value, datum_presnost: "presne" } : { datum: null });
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
