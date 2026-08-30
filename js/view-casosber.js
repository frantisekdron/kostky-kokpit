/*
 * view-casosber.js — sekce "Časosběr" (KONTRAKT_DODATEK.md §A).
 *
 * Rozhodovací nástroj: kam se pověsí dvě časosběrné kamery na tři roky.
 * František 26. 8. 2026 nalétal místa, ze kterých by záběr mohl být dobrý,
 * a má z toho 40 finálních fotek. Sekce má tři části:
 *
 *   0. PRUH INSTALAČNÍ NÁVŠTĚVY — „Instalace kamer — návštěva č. N,
 *      termín, stav" s odkazem na #navstevy. Návštěva se hledá podle
 *      milnik_id === "mil-01b", NE podle čísla (to se při přeplánování
 *      posune).
 *   1. SOUHRN (§A.8) — schválená místa X ze 2 potřebných, semafor
 *      připravenosti k instalaci (kolik míst má současně schválený
 *      přístup A potvrzené napájení), počet snímků v galerii a kolik
 *      jich už má popis.
 *   2. PŘEHLEDOVÁ MAPA (§A.5) — všechny body najednou: vybraná místa jako
 *      velké číslované markery, snímky z náletu jako tlumené tečky.
 *   3. VYBRANÁ MÍSTA — karty s fotkou, popisem, mapou, výškou, směrem
 *      pohledu, vzdáleností, zvolenou kamerou a komentáři. Navíc tři
 *      řádky se štítkem stavu, které rozhodují o osazení kamery:
 *      Přístup (stav místa + jedna_s + pristup_popis), Napájení 230 V
 *      (napajeni.stav + popis) a Internet (internet.stav + popis).
 *      Tlačítko „Kopírovat dotaz pro stavbu" z nich vyrobí hotový text
 *      do mailu pro PORR / stavbyvedoucího.
 *   3b. FOTKA U MÍSTA — u každého místa jde fotku přidat třemi cestami
 *      (nahrát ze souboru z telefonu/počítače, vybrat ze snímků náletu,
 *      vložit odkaz https://) a zase ji odebrat. Blok „Fotka" je jak
 *      v úpravě místa, tak přímo na kartě (tlačítka Přidat/Změnit fotku
 *      a Odebrat fotku vedle náhledu).
 *   4. GALERIE NÁLETU (§A.3) — mřížka 40 dlaždic s filtrem
 *      Vše | Do 35 m (pro kameru) | Z dronu | Z ruční kamery | S popisem
 *      (výchozí „Do 35 m"). Detail snímku v modálu má velký náhled, pole
 *      Popis, mapu s bodem a tlačítko „Vybrat jako místo pro kameru".
 *
 * Data:
 *   NALET (js/nalet.js)     zapečený seznam snímků, KONSTANTA — nezapisuje se
 *   App.polozky("casosber") vybraná místa (obálka data/casosber.json)
 *   App.data.casosber.popisy  popisy snímků z náletu (§A.4) — jediné místo
 *                           v celé appce, kde se sahá na App.data přímo:
 *                           `popisy` je sourozenec `polozky` v obálce a
 *                           App.polozky/App.obsah se k němu nedostanou
 *                           (App.obsah vrací {} u obálky s klíčem polozky).
 *   App.polozky("aktivita") komentáře k místům (entita:"casosber")
 *
 * Zápis: GH.zmen("casosber", fn, popis) a GH.zmen("aktivita", ...), po úspěchu
 * vždy App.uloz(soubor, obálka). Právo na jakoukoli změnu: casosber.upravit.
 * Nahrané fotky jdou přes GH.nahrajSoubor("foto/casosber/<id místa>.jpg", …)
 * do privátního repa; v demu se nikam neposílají a zůstanou jako data: URL
 * v localStorage prohlížeče.
 *
 * FOTKA U MÍSTA — jedno pole `foto` místo dřívějších dvou:
 *   foto: { zdroj: "nalet"|"repo"|"url"|"data"|null, cesta: "", foto_id: null }
 *     nalet  … snímek z náletu, cesta se dopočítá z NALET podle foto_id
 *     repo   … nahraná fotka v privátním repu, `cesta` = cesta v repu
 *     url    … externí odkaz (jen https://), `cesta` = odkaz
 *     data   … data: URL — jen demo režim, žije v localStorage prohlížeče
 *   Čtení je zpětně snášenlivé: položka bez `foto`, ale se starým `foto_id`
 *   nebo `foto_url`, se chová, jako by nové pole měla (viz fotkaMista()).
 *   Zápis nové fotky stará pole nemaže, jen je u zdrojů, které je umí
 *   vyjádřit, srovná; odebrání fotky maže obojí (jinak by starou fotku
 *   oživila právě ta zpětná snášenlivost). Soubor v repu se nikdy nemaže —
 *   může na něj odkazovat něco jiného, jen se od místa odpojí.
 *
 * Blok `popisy` (§A.4) je v obálce casosber.json sourozenec `polozky`.
 * gh.js proto u tohoto souboru předává mutační funkci CELOU obálku
 * (ziskejMutovatelnaData → ROZSIRENA_OBALKA), takže se popisy ukládají
 * normálně do repa. Kód níž si i tak ověřuje, co dostal, a nouzové uložení
 * do paměti relace zůstává jako pojistka pro případ, že by se datová
 * vrstva někdy změnila.
 *
 * Nevystavuje žádný nový globální objekt — jen se registruje jako sekce
 * "casosber" přes App.registrujSekci().
 */

(function () {
  "use strict";

  // ------------------------------------------------------------------
  // Konstanty
  // ------------------------------------------------------------------

  var POTREBA_MIST = 2;          // dvě kamery = dvě schválená místa (§A.8)

  // Seznam snímků z náletu byl dřív zapečený v js/nalet.js. Jsou to ale DATA
  // (souřadnice a výšky našich stanovišť) a ve veřejném repu žádná data být
  // nesmí (audit 30. 8. 2026) — bere se proto z privátního datového repa
  // stejně jako všechno ostatní. Naplní se při každém vykreslení sekce.
  var TEREN_M = 260.0;
  var SNIMKY = [];

  function nactiNalet() {
    var d = (window.App && typeof App.obsah === "function") ? App.obsah("nalet") : null;
    if (d && Array.isArray(d.polozky)) {
      SNIMKY = d.polozky;
      if (typeof d.teren_m === "number") TEREN_M = d.teren_m;
    }
  }

  var STAVY = [
    { kod: "navrzeno", nazev: "Navrženo" },
    { kod: "jedna-se", nazev: "Jedná se" },
    { kod: "schvaleno", nazev: "Schváleno" },
    { kod: "zamitnuto", nazev: "Zamítnuto" }
  ];

  var FILTRY = [
    { kod: "vse", nazev: "Vše" },
    { kod: "dron", nazev: "Z dronu" },
    { kod: "rucni", nazev: "Z ruční kamery" },
    { kod: "popis", nazev: "S popisem" }
  ];

  // ------------------------------------------------------------------
  // Napájení a internet — fáze mezi výběrem místa a instalací kamer.
  // Barvu štítku bere existující třída ze styles.css, žádná nová se
  // nezavádí: stav-navrzeno = šedá, stav-jedna-se = oranžová,
  // stav-schvaleno = zelená, stitek-chyba = červená.
  // ------------------------------------------------------------------

  var STAVY_NAPAJENI = [
    { kod: "nezjisteno", nazev: "nezjištěno", trida: "stav-navrzeno" },
    { kod: "dotaz-odeslan", nazev: "dotaz odeslán", trida: "stav-jedna-se" },
    { kod: "potvrzeno", nazev: "potvrzeno", trida: "stav-schvaleno" },
    { kod: "neni", nazev: "není", trida: "stitek-chyba" }
  ];

  var STAVY_INTERNETU = [
    { kod: "nezjisteno", nazev: "nezjištěno", trida: "stav-navrzeno" },
    { kod: "dotaz-odeslan", nazev: "dotaz odeslán", trida: "stav-jedna-se" },
    { kod: "wifi", nazev: "wi-fi", trida: "stav-schvaleno" },
    { kod: "kabel", nazev: "kabel", trida: "stav-schvaleno" },
    { kod: "neni", nazev: "není", trida: "stitek-chyba" }
  ];

  // Instalační návštěvu hledáme podle milníku, NE podle čísla — čísla
  // návštěv se při přeplánování posouvají, id milníku ne.
  var MILNIK_INSTALACE = "mil-01b";

  // Trvalý odběr časosběrné kamery — jde do dotazu pro stavbu, ať se
  // elektrikář nemusí ptát.
  var ODBER_KAMERY_W = 15;

  // ---- Fotka u místa ----
  // Telefonní fotky mají klidně 8 MB; do repa (a v demu do localStorage)
  // posíláme až zmenšenou a překódovanou verzi.
  var LIMIT_FOTKY_MB = 4;         // víc od uživatele ani nevezmeme
  var MAX_STRANA_PX = 1600;       // delší strana po zmenšení (ostrý provoz)
  var MAX_STRANA_DEMO_PX = 900;   // v demu míň, ať se data: URL vejde do localStorage
  var KVALITA_JPEG = 0.85;
  var SLOZKA_FOTEK = "foto/casosber/"; // v privátním repu kostky-data
  var DEMO_KLIC_ULOZISTE = "kostky_demo"; // jen ke kontrole, že se fotka vešla

  // ------------------------------------------------------------------
  // Stav modulu — přežívá překreslení sekce (App.prekresli), ale ne reload
  // ------------------------------------------------------------------

  var aktivniFiltr = "vse";       // Franta 30. 8.: filtr „do 35 m" pryč
  var otevreneKomentare = {};     // id místa -> true
  var obrazkyVPameti = new Map(); // cesta v repu -> src (data: URL / relativní cesta) | null
  var rucniBody = new Map();      // id snímku bez GPS -> { lat, lon } určený klikem do mapy
  var popisyVPameti = {};         // nouzové úložiště popisů, viz zmenCasosber()
  var popisyJenVPameti = false;   // true = gh.js blok `popisy` nezapsal
  var pozorovatelNahledu = null;  // IntersectionObserver pro postupné načítání (§A.6)
  var zivyMapy = [];              // instance map aktuálního vykreslení (kvůli .znic())

  // ------------------------------------------------------------------
  // Drobné pomocné funkce
  // ------------------------------------------------------------------

  // Výšky nad terénem vidí jen super admin (Franta 30. 8. 2026). Je to údaj
  // z našeho náletu, ne něco, co by PORR nebo Metrostav potřebovali řešit —
  // a v cizích rukou je to zbytečný detail o tom, jak létáme.
  function smiVidetVysky() {
    return !!(window.Auth && Auth.role === "superadmin");
  }

  function jeCislo(hodnota) {
    return typeof hodnota === "number" && isFinite(hodnota);
  }

  function cislo(text) {
    // "31.6" i "31,6" -> 31.6; prázdné / nesmysl -> null
    if (text === null || text === undefined) return null;
    var ocisteny = String(text).trim().replace(",", ".");
    if (!ocisteny) return null;
    var hodnota = Number(ocisteny);
    return isFinite(hodnota) ? hodnota : null;
  }

  function cesky(hodnota, desetinnych) {
    if (!jeCislo(hodnota)) return "—";
    return hodnota.toFixed(desetinnych === undefined ? 1 : desetinnych).replace(".", ",");
  }

  function smiUpravit() {
    return !!(window.Auth && typeof Auth.can === "function" && Auth.can("casosber.upravit"));
  }

  function mojeId() {
    return window.Auth && Auth.ja && Auth.ja.id ? Auth.ja.id : "neznamy";
  }

  // Autor komentáře se v aktivitě ukládá jako PŘIHLAŠOVACÍ id ("honza"),
  // kdežto App.jmenoOsoby() hledá podle id položky v lide.json ("os-06").
  // Proto překlad přes pole `ma_pristup`; když se nenajde nic, zůstane id.
  function jmenoAutora(kdo) {
    if (!kdo) return "—";
    var osoba = App.osoba(kdo);
    if (osoba && osoba.jmeno) return osoba.jmeno;
    var lide = App.polozky("lide");
    for (var i = 0; i < lide.length; i++) {
      if (lide[i] && lide[i].ma_pristup === kdo && lide[i].jmeno) return lide[i].jmeno;
    }
    return String(kdo);
  }

  function nazevStavu(kod) {
    for (var i = 0; i < STAVY.length; i++) {
      if (STAVY[i].kod === kod) return STAVY[i].nazev;
    }
    return kod || "—";
  }

  // Stavy časosběru používají SPOLEČNÉ třídy "stav-<hodnota>" ze styles.css
  // (stejné jako plán, návštěvy a materiály) — navrzeno / jedna-se /
  // schvaleno / zamitnuto tam už mají svoji barvu přes --stav-barva.
  function tridaStavu(kod) {
    return "stav-" + (kod || "navrzeno");
  }

  function najdiPodleId(polozky, id) {
    for (var i = 0; i < polozky.length; i++) {
      if (polozky[i] && polozky[i].id === id) return polozky[i];
    }
    return null;
  }

  // ------------------------------------------------------------------
  // Fotka místa — jednotný model `foto` (viz hlavičku souboru)
  // ------------------------------------------------------------------

  function jeDemoRezim() {
    return typeof window !== "undefined" && window.DEMO === true;
  }

  function prazdnaFotka() {
    return { zdroj: null, cesta: "", foto_id: null };
  }

  // Jediné místo, kde se fotka místa čte. Snáší i starý tvar (foto_id/foto_url).
  function fotkaMista(misto) {
    if (!misto) return prazdnaFotka();
    var f = misto.foto;
    if (f && typeof f === "object" && f.zdroj) {
      return {
        zdroj: String(f.zdroj),
        cesta: f.cesta ? String(f.cesta) : "",
        foto_id: f.foto_id || null
      };
    }
    if (misto.foto_id) {
      return { zdroj: "nalet", cesta: "", foto_id: misto.foto_id };
    }
    if (misto.foto_url && Util.bezpecnyOdkaz(misto.foto_url)) {
      return { zdroj: "url", cesta: String(misto.foto_url).trim(), foto_id: null };
    }
    return prazdnaFotka();
  }

  function cestaFotkyVRepu(idMista) {
    return SLOZKA_FOTEK + idMista + ".jpg";
  }

  // Zapíše fotku do položky. Stará pole se nemažou (ať se nic neztratí), jen
  // se u zdrojů, které je umí vyjádřit, srovnají. Výjimka je odebrání fotky:
  // tam se stará pole vyprázdnit MUSÍ, jinak by fotku vzkřísilo zpětně
  // snášenlivé čtení ve fotkaMista().
  function zapisFotkuDoPolozky(polozka, fotka) {
    var f = fotka && fotka.zdroj ? fotka : prazdnaFotka();
    polozka.foto = { zdroj: f.zdroj, cesta: f.cesta || "", foto_id: f.foto_id || null };
    if (f.zdroj === "nalet") {
      polozka.foto_id = f.foto_id || null;
    } else if (f.zdroj === "url") {
      polozka.foto_url = f.cesta || "";
    } else if (!f.zdroj) {
      polozka.foto_id = null;
      polozka.foto_url = "";
    }
  }

  function chybaSHlaskou(text) {
    var chyba = new Error(text);
    chyba.hlaska = text;
    return chyba;
  }

  // V demu ukládá gh.js celý stav do localStorage a překročení kvóty jen
  // zaloguje — zápis tedy „projde", ale po přenačtení by fotka zmizela.
  // Ověříme si proto sami, že se data: URL do úložiště opravdu vešla.
  function overDemoUlozeni(fotka) {
    if (!jeDemoRezim() || !fotka || fotka.zdroj !== "data") return true;
    var otisk = String(fotka.cesta || "").slice(0, 200);
    if (!otisk) return true;
    var ulozeno = null;
    try {
      ulozeno = window.localStorage.getItem(DEMO_KLIC_ULOZISTE);
    } catch (chyba) {
      return true; // localStorage není (soukromý režim) — demo běží z paměti
    }
    if (ulozeno && ulozeno.indexOf(otisk) !== -1) return true;
    App.toast(
      "Fotka se do úložiště prohlížeče nevešla — zůstane jen do přenačtení stránky. " +
        "Uvolni místo tlačítkem „Vymazat demo data\" v oranžovém pruhu.",
      "chyba"
    );
    return false;
  }

  // ------------------------------------------------------------------
  // Napájení / internet — čtení a normalizace
  // ------------------------------------------------------------------

  function polozkaCiselniku(ciselnik, kod) {
    for (var i = 0; i < ciselnik.length; i++) {
      if (ciselnik[i].kod === kod) return ciselnik[i];
    }
    return ciselnik[0]; // neznámý kód ze starých dat -> "nezjištěno"
  }

  // Tolerantní čtení: místa založená před touhle změnou blok nemají.
  function blokStavu(ciselnik, hodnota) {
    var zdroj = hodnota && typeof hodnota === "object" ? hodnota : {};
    return {
      stav: polozkaCiselniku(ciselnik, zdroj.stav).kod,
      popis: zdroj.popis ? String(zdroj.popis) : ""
    };
  }

  function napajeniMista(misto) {
    return blokStavu(STAVY_NAPAJENI, misto ? misto.napajeni : null);
  }

  function internetMista(misto) {
    return blokStavu(STAVY_INTERNETU, misto ? misto.internet : null);
  }

  function pristupPopisMista(misto) {
    return misto && misto.pristup_popis ? String(misto.pristup_popis) : "";
  }

  // Prázdný blok ve správném tvaru pro nově zakládaná místa.
  function prazdnyBlokStavu() {
    return { stav: "nezjisteno", popis: "" };
  }

  // Místo je připravené k osazení kamery, když je domluvený přístup
  // (stav místa "schvaleno") A potvrzené napájení. Internet je vítaný,
  // ale bez něj se dá data stahovat ručně při návštěvě — proto do
  // téhle podmínky nevstupuje.
  function jePripraveneKInstalaci(misto) {
    return misto.stav === "schvaleno" && napajeniMista(misto).stav === "potvrzeno";
  }

  // ------------------------------------------------------------------
  // Snímky z náletu
  // ------------------------------------------------------------------

  function indexSnimku(id) {
    for (var i = 0; i < SNIMKY.length; i++) {
      if (SNIMKY[i].id === id) return i;
    }
    return -1;
  }

  function snimekPodleId(id) {
    var i = indexSnimku(id);
    return i === -1 ? null : SNIMKY[i];
  }

  function cisloSnimku(id) {
    var i = indexSnimku(id);
    return i === -1 ? null : i + 1;
  }

  // Snímky z ruční kamery nemají v datech čas — popisek se pak zkrátí.
  function popisekSnimku(snimek, index) {
    var zaklad = "#" + (index + 1);
    return snimek && snimek.cas ? zaklad + " · " + snimek.cas : zaklad;
  }

  // Poloha snímku: buď z náletu, nebo ručně naklikaná v detailu (§A.3).
  function polohaSnimku(snimek) {
    if (!snimek) return null;
    if (Mapa.platnyBod(snimek.lat, snimek.lon)) {
      return { lat: snimek.lat, lon: snimek.lon, rucni: false };
    }
    var rucni = rucniBody.get(snimek.id);
    if (rucni && Mapa.platnyBod(rucni.lat, rucni.lon)) {
      return { lat: rucni.lat, lon: rucni.lon, rucni: true };
    }
    return null;
  }

  // Výchozí střed mapy, když snímek souřadnice nemá — GPS stavby z nastavení.
  function stredStavby() {
    var nastaveni = App.obsah("nastaveni");
    var gps = nastaveni && nastaveni.gps ? nastaveni.gps : null;
    if (gps && Mapa.platnyBod(gps.lat, gps.lon)) return { lat: gps.lat, lon: gps.lon };
    // záloha: průměr souřadnic snímků z náletu
    var soucetLat = 0;
    var soucetLon = 0;
    var pocet = 0;
    SNIMKY.forEach(function (s) {
      if (Mapa.platnyBod(s.lat, s.lon)) {
        soucetLat += s.lat;
        soucetLon += s.lon;
        pocet++;
      }
    });
    if (pocet) return { lat: soucetLat / pocet, lon: soucetLon / pocet };
    // Záložní střed mapy bereme z nastavení projektu (privátní repo), ne
    // natvrdo z kódu — ve veřejném repu nemá být žádný údaj o stavbě.
    var g = (App.obsah("nastaveni") || {}).gps || {};
    return { lat: jeCislo(g.lat) ? g.lat : 50.08, lon: jeCislo(g.lon) ? g.lon : 14.42 };
  }

  // ------------------------------------------------------------------
  // Výšky (§A.3) — chybějící se dopočítá z terénu 260,0 m n. m.
  // ------------------------------------------------------------------

  function dopocitejVysky(vyskaNadTerenem, nadmorskaVyska) {
    var vyska = jeCislo(vyskaNadTerenem) ? vyskaNadTerenem : null;
    var nadmorska = jeCislo(nadmorskaVyska) ? nadmorskaVyska : null;
    var dopocitano = false;
    if (vyska === null && nadmorska !== null) {
      vyska = nadmorska - TEREN_M;
      dopocitano = true;
    } else if (nadmorska === null && vyska !== null) {
      nadmorska = TEREN_M + vyska;
      dopocitano = true;
    }
    return { vyska: vyska, nadmorska: nadmorska, dopocitano: dopocitano };
  }

  function textVysky(vyskaNadTerenem, nadmorskaVyska) {
    var v = dopocitejVysky(vyskaNadTerenem, nadmorskaVyska);
    if (v.vyska === null && v.nadmorska === null) return null;
    if (!smiVidetVysky()) return "";
    return cesky(v.vyska) + " m nad terénem · " + cesky(v.nadmorska) + " m n. m.";
  }

  // Blok „X m nad terénem · Y m n. m." + případná drobná poznámka o terénu.
  function blokVysky(vyskaNadTerenem, nadmorskaVyska) {
    var obal = document.createElement("div");
    obal.className = "cas-vyska";
    var text = textVysky(vyskaNadTerenem, nadmorskaVyska);
    var hlavni = document.createElement("p");
    hlavni.className = "cas-vyska-hlavni";
    hlavni.textContent = text || "Výška zatím není známá.";
    obal.appendChild(hlavni);
    var v = dopocitejVysky(vyskaNadTerenem, nadmorskaVyska);
    if (v.dopocitano) {
      var pozn = document.createElement("p");
      pozn.className = "cas-drobne";
      pozn.textContent = "terén " + cesky(TEREN_M, 0) + " m n. m.";
      obal.appendChild(pozn);
    }
    return obal;
  }

  // ------------------------------------------------------------------
  // Čtení dat sekce
  // ------------------------------------------------------------------

  function mista() {
    return App.polozky("casosber")
      .filter(function (p) {
        return p && !p.smazano;
      })
      .sort(function (a, b) {
        var pa = jeCislo(a.poradi) ? a.poradi : 9999;
        var pb = jeCislo(b.poradi) ? b.poradi : 9999;
        if (pa !== pb) return pa - pb;
        return String(a.id) < String(b.id) ? -1 : 1;
      });
  }

  // Pozor: čte se přes fotkaMista(), ne přímo přes foto_id — místo, kterému
  // se snímek z náletu nastavil až dodatečně (blok „Fotka"), je taky vybrané,
  // a naopak místo s nahranou fotkou už snímek z náletu neblokuje.
  function mistoZeSnimku(fotoId) {
    var vsechna = mista();
    for (var i = 0; i < vsechna.length; i++) {
      var f = fotkaMista(vsechna[i]);
      if (f.zdroj === "nalet" && f.foto_id === fotoId) return vsechna[i];
    }
    return null;
  }

  // `popisy` je sourozenec `polozky` v obálce casosber.json — App.polozky ani
  // App.obsah se k němu nedostanou, proto (a jedině tady) čteme App.data přímo.
  function popisyZObalky() {
    var obalka = App.data && App.data.casosber ? App.data.casosber : null;
    if (!obalka || !obalka.popisy || typeof obalka.popisy !== "object") return {};
    return obalka.popisy;
  }

  function popisSnimku(fotoId) {
    if (Object.prototype.hasOwnProperty.call(popisyVPameti, fotoId)) {
      return popisyVPameti[fotoId] || "";
    }
    var zObalky = popisyZObalky();
    if (Object.prototype.hasOwnProperty.call(zObalky, fotoId) && zObalky[fotoId]) {
      return String(zObalky[fotoId]);
    }
    var snimek = snimekPodleId(fotoId);
    return snimek && snimek.popis ? String(snimek.popis) : "";
  }

  function pocetSnimkuSPopisem() {
    var pocet = 0;
    SNIMKY.forEach(function (s) {
      if (popisSnimku(s.id).trim()) pocet++;
    });
    return pocet;
  }

  // ------------------------------------------------------------------
  // Instalační návštěva ("Instalace časosběrných kamer")
  // ------------------------------------------------------------------

  var STAVY_NAVSTEVY = {
    navrh: "Návrh",
    "ke-schvaleni": "Čeká na schválení",
    schvaleno: "Schváleno",
    potvrzeno: "Potvrzeno",
    probehlo: "Proběhlo",
    zruseno: "Zrušeno"
  };

  // Hledá se podle milnik_id, ne podle čísla návštěvy — číslo se při
  // přeplánování posune, vazba na milník zůstane.
  function najdiInstalacniNavstevu() {
    var navstevy = App.polozky("navstevy");
    for (var i = 0; i < navstevy.length; i++) {
      var n = navstevy[i];
      if (n && !n.smazano && n.milnik_id === MILNIK_INSTALACE) return n;
    }
    return null;
  }

  function terminNavstevy(navsteva) {
    if (!navsteva || !navsteva.datum) return "";
    return Util.formatDatum(navsteva.datum, navsteva.datum_presnost || "presne", navsteva.datum_do || null);
  }

  // ------------------------------------------------------------------
  // Dotaz pro stavbu (text do schránky) — Franta ho pošle mailem Lucii
  // nebo stavbyvedoucímu. Věcně, krátce, množné číslo za firmu.
  // ------------------------------------------------------------------

  function textDotazuProStavbu(misto) {
    var nastaveni = App.obsah("nastaveni");
    // "Pragerovy kostky — Emauzy II" -> "Pragerovy kostky", stejně jako
    // ve svolávce (Util.svolavka): do mailu patří jméno, kterým stavbu
    // všichni znají, ne celý název s podnázvem.
    var nazevProjektu = String((nastaveni && nastaveni.nazev) || "Pragerovy kostky").split(" — ")[0];

    var radky = [];
    radky.push(nazevProjektu + " — časosběrná kamera, místo: " + (misto.nazev || "bez názvu"));

    // Souřadnice v tečkovém formátu se dají rovnou vložit do map.
    // Když je místo nemá, řádek Poloha se vynechá — nikdy „null".
    var maBod = misto.bod && Mapa.platnyBod(misto.bod.lat, misto.bod.lon);
    var vysky = dopocitejVysky(misto.vyska_nad_terenem_m, misto.nadmorska_vyska_m);
    var textVysek = "";
    if (vysky.vyska !== null || vysky.nadmorska !== null) {
      if (smiVidetVysky()) {
        textVysek = "výška " + cesky(vysky.vyska) + " m nad terénem (" + cesky(vysky.nadmorska) + " m n. m.)";
      }
    }
    if (maBod) {
      var radekPolohy = "Poloha: " + misto.bod.lat.toFixed(6) + ", " + misto.bod.lon.toFixed(6);
      if (textVysek) radekPolohy += " · " + textVysek;
      radky.push(radekPolohy);
    } else if (textVysek) {
      // Poloha neznámá, ale výšku už víme — ta stavbu zajímá kvůli lešení.
      radky.push("Výška: " + textVysek.replace("výška ", ""));
    }

    if (misto.popis) radky.push(misto.popis);

    // Odkaz na snímek z náletu — bez něj adresát netuší, o který roh objektu
    // jde. Souřadnice v mailu si nikdo neotevře, fotku ano.
    var fotkaProDotaz = fotkaMista(misto);
    if (fotkaProDotaz.zdroj) {
      var snimekProDotaz = fotkaProDotaz.zdroj === "nalet" && fotkaProDotaz.foto_id
        ? snimekPodleId(fotkaProDotaz.foto_id)
        : null;
      if (snimekProDotaz && snimekProDotaz.soubor) {
        radky.push("Fotku místa posíláme v příloze (snímek " + snimekProDotaz.soubor +
          " z náletu 26. 8. 2026).");
      } else {
        radky.push("Fotku místa posíláme v příloze.");
      }
    }

    radky.push("");
    radky.push("Prosíme o potvrzení tří věcí, abychom mohli kameru osadit:");
    radky.push("1) Přístup na místo — s kým to domluvit a kdy tam můžeme.");
    radky.push("2) Napájení 230 V — je na místě zásuvka? Odkud se dá vzít proud");
    radky.push("   a kdo připojení provede? Kamera má trvalý odběr do " + ODBER_KAMERY_W + " W.");
    radky.push("3) Připojení k internetu — je tam wi-fi, kterou můžeme použít,");
    radky.push("   nebo je možnost natáhnout kabel? Bez připojení bude potřeba");
    radky.push("   data stahovat ručně při každé návštěvě.");
    radky.push("");

    var navsteva = najdiInstalacniNavstevu();
    var termin = terminNavstevy(navsteva);
    if (termin) {
      radky.push("Instalaci plánujeme na " + termin + ", ideálně před instalací");
    } else {
      radky.push("Instalaci plánujeme ještě před instalací");
    }
    radky.push("buňkoviště a lešení, ať kamery zachytí i tuhle fázi.");

    return radky.join("\n");
  }

  function zkopirujDotazProStavbu(misto) {
    Util.doSchranky(textDotazuProStavbu(misto)).then(function (ok) {
      if (ok) {
        App.toast("Dotaz pro stavbu zkopírován do schránky.", "ok");
      } else {
        App.toast("Kopírování do schránky se nepovedlo — zkus to ručně.", "chyba");
      }
    });
  }

  // ------------------------------------------------------------------
  // Zápis do casosber.json
  // ------------------------------------------------------------------
  //
  // gh.js u souboru "casosber" předává mutační funkci CELOU obálku (seznam
  // ROZSIRENA_OBALKA v ziskejMutovatelnaData), protože blok `popisy` (§A.4)
  // je sourozenec pole `polozky` a z pole samotného by se na něj nedalo
  // dosáhnout. Tahle funkce si pro jistotu poradí i s holým polem — kdyby
  // datová vrstva někdy zase podala jen `polozky`, popisy se místo ztráty
  // uloží aspoň do paměti relace a uživatel na to dostane hlášku.

  function zmenCasosber(mutuj, popisZmeny) {
    return GH.zmen(
      "casosber",
      function (data) {
        if (Array.isArray(data)) {
          mutuj({ polozky: data, popisy: null });
          return;
        }
        if (!data.polozky || !Array.isArray(data.polozky)) data.polozky = [];
        if (!data.popisy || typeof data.popisy !== "object") data.popisy = {};
        mutuj(data);
      },
      popisZmeny
    );
  }

  function poUlozeni(obsah, hlaska) {
    App.uloz("casosber", obsah);
    if (hlaska) App.toast(hlaska, "ok");
    App.prekresli();
    return obsah;
  }

  function chybaZapisu(chyba, nahradniHlaska) {
    console.warn("Časosběr — zápis selhal:", chyba);
    App.toast((chyba && chyba.hlaska) || nahradniHlaska, "chyba");
  }

  // ------------------------------------------------------------------
  // Obrázky z privátního repa (§A.6) — data: URL s cache v GH + v paměti
  // ------------------------------------------------------------------

  // Když v demu chybí složka seed/ (nasazené demo na GitHub Pages ji nemá —
  // fotky ze stavby do veřejného repa nepatří), nemá smysl střílet 40 dotazů,
  // které všechny skončí na 404. První selhání si zapamatujeme a zbytku
  // rovnou napíšeme, jak to je.
  var nahledyNedostupne = false;

  function nactiObrazekDo(cesta, obrazek, stavovyPrvek) {
    if (!cesta || !obrazek) return;

    if (nahledyNedostupne) {
      obrazek.hidden = true;
      if (stavovyPrvek) {
        stavovyPrvek.hidden = false;
        stavovyPrvek.textContent = "Náhled je jen v lokálním demu.";
      }
      return;
    }

    function pouzij(src) {
      if (!src) {
        obrazek.hidden = true;
        if (stavovyPrvek) {
          stavovyPrvek.hidden = false;
          stavovyPrvek.textContent = "Náhled se nepodařilo načíst.";
        }
        return;
      }
      // V demu je src relativni cesta do seed/ — soubor tam nemusi byt
      // (na nasazenem demu na Pages seed/ neni, viz README cast g).
      // Bez tohohle handleru by zustal jen rozbity ramecek bez vysvetleni.
      obrazek.onerror = function () {
        obrazek.onerror = null;
        if (window.DEMO === true) nahledyNedostupne = true;
        obrazek.hidden = true;
        if (stavovyPrvek) {
          stavovyPrvek.hidden = false;
          stavovyPrvek.textContent = window.DEMO === true
            ? "Náhled je jen v lokálním demu."
            : "Náhled se nepodařilo načíst.";
        }
      };
      obrazek.src = src;
      obrazek.hidden = false;
      if (stavovyPrvek) stavovyPrvek.hidden = true;
    }

    if (obrazkyVPameti.has(cesta)) {
      pouzij(obrazkyVPameti.get(cesta));
      return;
    }
    if (!window.GH || typeof GH.nactiSoubor !== "function") {
      pouzij(null);
      return;
    }
    GH.nactiSoubor(cesta)
      .then(function (src) {
        obrazkyVPameti.set(cesta, src || null);
        pouzij(src);
      })
      .catch(function (chyba) {
        console.warn("Časosběr — načtení obrázku selhalo:", cesta, chyba);
        obrazkyVPameti.set(cesta, null);
        pouzij(null);
      });
  }

  // Postupné načítání náhledů v mřížce — ne všech 40 naráz (§A.6).
  // Jednorázové ověření, jestli jsou v demu náhledy vůbec dostupné. Na
  // nasazeném demu (GitHub Pages) složka seed/ není a bez tohohle by 40
  // dlaždic vystřelilo 40 dotazů na 404 dřív, než se vrátí první chyba —
  // v konzoli by z toho byla stěna červených hlášek. Proveříme jednu cestu
  // a teprve pak spustíme mřížku.
  var overeniNahledu = null;

  function overNahledy(prvniCesta) {
    if (window.DEMO !== true || !prvniCesta) return Promise.resolve();
    if (overeniNahledu) return overeniNahledu;
    overeniNahledu = new Promise(function (hotovo) {
      if (!window.GH || typeof GH.nactiSoubor !== "function") { hotovo(); return; }
      Promise.resolve(GH.nactiSoubor(prvniCesta))
        .then(function (src) {
          if (!src) { nahledyNedostupne = true; hotovo(); return; }
          // V demu je src relativní cesta — ověříme ji jedním dotazem.
          var zkouska = new Image();
          zkouska.onload = function () { hotovo(); };
          zkouska.onerror = function () { nahledyNedostupne = true; hotovo(); };
          zkouska.src = src;
        })
        .catch(function () { nahledyNedostupne = true; hotovo(); });
    });
    return overeniNahledu;
  }

  function zapniPozorovatele(korene) {
    zrusPozorovatele();

    // Nejdřív ověřit dostupnost, pak teprve pouštět mřížku.
    if (window.DEMO === true && !nahledyNedostupne && overeniNahledu === null) {
      var prvni = korene.length ? korene[0].cesta : null;
      overNahledy(prvni).then(function () { zapniPozorovatele(korene); });
      return;
    }
    if (typeof window.IntersectionObserver !== "function") {
      // starý prohlížeč: načteme rovnou, mřížka je konečná (40 položek)
      korene.forEach(function (zaznam) {
        nactiObrazekDo(zaznam.cesta, zaznam.obrazek, zaznam.stav);
      });
      return;
    }
    var podleElementu = new Map();
    pozorovatelNahledu = new window.IntersectionObserver(
      function (zaznamy, pozorovatel) {
        zaznamy.forEach(function (zaznam) {
          if (!zaznam.isIntersecting) return;
          var data = podleElementu.get(zaznam.target);
          pozorovatel.unobserve(zaznam.target);
          if (data) nactiObrazekDo(data.cesta, data.obrazek, data.stav);
        });
      },
      { rootMargin: "300px 0px" }
    );
    korene.forEach(function (zaznam) {
      podleElementu.set(zaznam.prvek, zaznam);
      pozorovatelNahledu.observe(zaznam.prvek);
    });
  }

  function zrusPozorovatele() {
    if (pozorovatelNahledu) {
      pozorovatelNahledu.disconnect();
      pozorovatelNahledu = null;
    }
  }

  function zrusMapy() {
    zivyMapy.forEach(function (mapa) {
      if (mapa && typeof mapa.znic === "function") {
        try {
          mapa.znic();
        } catch (chyba) {
          console.warn("Časosběr — úklid mapy selhal:", chyba);
        }
      }
    });
    zivyMapy = [];
  }

  // ------------------------------------------------------------------
  // Otevření velkého snímku v nové záložce (data: URL projde jen přes blob)
  // ------------------------------------------------------------------

  function nastavOdkazNaVelky(odkaz, src) {
    if (!odkaz || !src) return;
    if (src.slice(0, 5) !== "data:") {
      odkaz.href = src;
      return;
    }
    // Prohlížeče blokují navigaci na data: URL v nové záložce — uděláme blob.
    fetch(src)
      .then(function (odpoved) {
        return odpoved.blob();
      })
      .then(function (blob) {
        odkaz.href = URL.createObjectURL(blob);
      })
      .catch(function (chyba) {
        console.warn("Časosběr — blob pro velký náhled selhal:", chyba);
        odkaz.removeAttribute("href");
      });
  }

  // ------------------------------------------------------------------
  // Souhrn nahoře (§A.8)
  // ------------------------------------------------------------------

  function vytvorSouhrn() {
    var vsechna = mista();
    var schvalena = vsechna.filter(function (m) {
      return m.stav === "schvaleno";
    }).length;

    var karta = document.createElement("section");
    karta.className = "karta cas-souhrn";

    var hlavni = document.createElement("div");
    hlavni.className = "cas-souhrn-hlavni";

    var cisloEl = document.createElement("span");
    cisloEl.className = "souhrn-cislo";
    cisloEl.textContent = schvalena + " ze " + POTREBA_MIST;
    hlavni.appendChild(cisloEl);

    var popisek = document.createElement("span");
    popisek.className = "cas-souhrn-popisek";
    popisek.textContent = "schválená místa pro kamery";
    hlavni.appendChild(popisek);

    karta.appendChild(hlavni);

    if (schvalena < POTREBA_MIST) {
      var varovani = document.createElement("p");
      varovani.className = "cas-souhrn-varovani";
      varovani.textContent = "Zatím není vybráno dost míst pro dvě kamery.";
      karta.appendChild(varovani);
    }

    // Semafor připravenosti k instalaci — hlavní věc, kterou je potřeba
    // vidět na první pohled: kolik míst má SOUČASNĚ schválený přístup
    // a potvrzené napájení.
    var pripravena = vsechna.filter(jePripraveneKInstalaci).length;
    var radekPripravenosti = document.createElement("div");
    radekPripravenosti.className = "cas-udaj";
    var popisekPripravenosti = document.createElement("span");
    popisekPripravenosti.className = "cas-udaj-popisek";
    popisekPripravenosti.textContent = "Připraveno k instalaci";
    radekPripravenosti.appendChild(popisekPripravenosti);
    var stitekPripravenosti = document.createElement("span");
    stitekPripravenosti.className =
      "stitek " + (pripravena >= POTREBA_MIST ? "stav-schvaleno" : "stav-jedna-se");
    stitekPripravenosti.textContent = pripravena + " ze " + POTREBA_MIST;
    radekPripravenosti.appendChild(stitekPripravenosti);
    var hodnotaPripravenosti = document.createElement("span");
    hodnotaPripravenosti.className = "cas-udaj-hodnota";
    hodnotaPripravenosti.textContent = "schválený přístup a potvrzené napájení 230 V";
    radekPripravenosti.appendChild(hodnotaPripravenosti);
    karta.appendChild(radekPripravenosti);

    if (pripravena < POTREBA_MIST) {
      var varovaniInstalace = document.createElement("p");
      varovaniInstalace.className = "cas-souhrn-varovani";
      varovaniInstalace.textContent =
        "Instalace kamer zatím není připravená — chybí potvrzený přístup nebo napájení.";
      karta.appendChild(varovaniInstalace);
    }

    var meta = document.createElement("p");
    meta.className = "karta-meta";
    meta.textContent =
      "Galerie náletu: " +
      SNIMKY.length +
      " snímků · s popisem " +
      pocetSnimkuSPopisem() +
      " · vybraná místa " +
      vsechna.length;
    karta.appendChild(meta);

    return karta;
  }

  // ------------------------------------------------------------------
  // Pruh s instalační návštěvou — fáze mezi výběrem míst (1) a prvním
  // natáčením podle harmonogramu (2). Návštěva se hledá podle milníku
  // mil-01b, ne podle čísla.
  // ------------------------------------------------------------------

  function vytvorPruhInstalace() {
    var navsteva = najdiInstalacniNavstevu();

    var karta = document.createElement("section");
    karta.className = "karta" + (navsteva ? " " + tridaStavu(navsteva.stav) : "");

    var nadpis = document.createElement("h3");
    nadpis.className = "karta-nadpis";
    if (navsteva) {
      var casti = ["Instalace kamer — návštěva č. " + navsteva.cislo];
      var termin = terminNavstevy(navsteva);
      if (termin) casti.push(termin);
      casti.push(STAVY_NAVSTEVY[navsteva.stav] || navsteva.stav || "");
      nadpis.textContent = casti.join(", ");
    } else {
      nadpis.textContent = "Instalace kamer — návštěva zatím není v plánu.";
    }
    karta.appendChild(nadpis);

    var popis = document.createElement("p");
    popis.className = "karta-meta";
    popis.textContent =
      "Kamery se osadí ještě před instalací buňkoviště a lešení, ať zachytí i tuhle fázi. " +
      "U obou míst k tomu musí být potvrzený přístup, napájení 230 V a připojení k internetu.";
    karta.appendChild(popis);

    var akce = document.createElement("div");
    akce.className = "karta-akce";
    var odkaz = document.createElement("a");
    odkaz.className = "btn btn-mala btn-sekundarni";
    odkaz.href = "#navstevy";
    odkaz.textContent = navsteva
      ? "Návštěva č. " + navsteva.cislo + " → Návštěvy"
      : "Otevřít Návštěvy";
    akce.appendChild(odkaz);
    karta.appendChild(akce);

    return karta;
  }

  // ------------------------------------------------------------------
  // Přehledová mapa se všemi body (§A.5)
  // ------------------------------------------------------------------

  function vytvorPrehledovouMapu() {
    var blok = document.createElement("section");
    blok.className = "oddil cas-prehledova-mapa";

    var nadpis = document.createElement("h3");
    nadpis.className = "podnadpis-sekce";
    nadpis.textContent = "Mapa všech bodů";
    blok.appendChild(nadpis);

    var kontejner = document.createElement("div");
    kontejner.className = "mapa mapa-velka";
    blok.appendChild(kontejner);

    var body = [];
    mista().forEach(function (m, index) {
      var bod = m.bod || {};
      if (!Mapa.platnyBod(bod.lat, bod.lon)) return;
      body.push({
        lat: bod.lat,
        lon: bod.lon,
        druh: "misto",
        cislo: index + 1,
        popisek: (index + 1) + " · " + (m.nazev || "Místo"),
        id: m.id
      });
    });
    SNIMKY.forEach(function (s, index) {
      var poloha = polohaSnimku(s);
      if (!poloha) return;
      body.push({
        lat: poloha.lat,
        lon: poloha.lon,
        druh: "snimek",
        popisek: "Snímek " + popisekSnimku(s, index),
        id: s.id
      });
    });

    if (!body.length) {
      var prazdno = document.createElement("p");
      prazdno.className = "karta-meta";
      prazdno.textContent = "Zatím není zaneseno ani jedno místo se souřadnicemi.";
      blok.appendChild(prazdno);
      kontejner.remove();
      return blok;
    }

    var instance = Mapa.vytvorPrehled(kontejner, body, {
      naKlik: function (marker) {
        if (marker.druh === "snimek") {
          otevriDetailSnimku(marker.id);
        } else {
          prejdiNaMisto(marker.id);
        }
      }
    });
    if (instance) zivyMapy.push(instance);

    var legenda = document.createElement("p");
    legenda.className = "cas-legenda";
    legenda.textContent = "Velké číslované body = vybraná místa. Malé tečky = snímky z náletu. Klikem se otevře detail.";
    blok.appendChild(legenda);

    return blok;
  }

  function prejdiNaMisto(id) {
    var prvek = document.getElementById("misto-" + id);
    if (!prvek) return;
    prvek.scrollIntoView({ behavior: "smooth", block: "center" });
    prvek.classList.add("cas-misto-zvyrazneno");
    window.setTimeout(function () {
      prvek.classList.remove("cas-misto-zvyrazneno");
    }, 1800);
  }

  // ------------------------------------------------------------------
  // Komentáře k místu (aktivita.json, entita:"casosber")
  // ------------------------------------------------------------------

  function vytvorKomentare(mistoId) {
    var komentare = App.polozky("aktivita")
      .filter(function (a) {
        return a && a.entita === "casosber" && a.entita_id === mistoId && a.druh === "komentar" && !a.smazano;
      })
      .sort(function (a, b) {
        return a.kdy < b.kdy ? -1 : a.kdy > b.kdy ? 1 : 0;
      });

    var detail = document.createElement("details");
    detail.className = "komentare";
    detail.open = !!otevreneKomentare[mistoId];
    detail.addEventListener("toggle", function () {
      if (detail.open) {
        otevreneKomentare[mistoId] = true;
      } else {
        delete otevreneKomentare[mistoId];
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
        var wrap = document.createElement("div");
        wrap.className = "komentar";

        var hlavicka = document.createElement("p");
        hlavicka.className = "karta-meta";
        var autor = document.createElement("strong");
        autor.textContent = jmenoAutora(k.kdo);
        hlavicka.appendChild(autor);
        hlavicka.appendChild(document.createTextNode(" · " + Util.formatCas(k.kdy)));
        wrap.appendChild(hlavicka);

        var text = document.createElement("p");
        text.className = "komentar-text";
        text.textContent = k.text;
        wrap.appendChild(text);

        var muzeSmazat =
          Auth.can("komentare.smazat.cizi") || (window.Auth && Auth.ja && Auth.ja.id === k.kdo);
        if (muzeSmazat) {
          var smazat = document.createElement("button");
          smazat.type = "button";
          smazat.className = "btn btn-mala btn-sekundarni";
          smazat.textContent = "Smazat komentář";
          smazat.addEventListener("click", function () {
            App.potvrd("Smazat tento komentář?").then(function (ano) {
              if (!ano) return;
              GH.zmen("aktivita", function (polozky) {
                var p = najdiPodleId(polozky, k.id);
                if (p) p.smazano = { kdy: new Date().toISOString(), kdo: mojeId() };
              })
                .then(function (obsah) {
                  App.uloz("aktivita", obsah);
                  App.toast("Komentář smazán.", "ok");
                  App.prekresli();
                })
                .catch(function (chyba) {
                  chybaZapisu(chyba, "Smazání komentáře selhalo.");
                });
            });
          });
          wrap.appendChild(smazat);
        }

        seznam.appendChild(wrap);
      });
    }
    detail.appendChild(seznam);

    if (Auth.can("komentare.pridat")) {
      detail.appendChild(vytvorFormularKomentare(mistoId));
    }

    return detail;
  }

  function vytvorFormularKomentare(mistoId) {
    var form = document.createElement("form");
    form.className = "komentar-formular";

    var pole = document.createElement("div");
    pole.className = "pole";
    var textarea = document.createElement("textarea");
    textarea.rows = 2;
    textarea.name = "text";
    textarea.placeholder = "Napsat komentář k místu…";
    pole.appendChild(textarea);
    form.appendChild(pole);

    var tlacitko = document.createElement("button");
    tlacitko.type = "submit";
    tlacitko.className = "btn btn-mala btn-primarni";
    tlacitko.textContent = "Přidat komentář";
    form.appendChild(tlacitko);

    form.addEventListener("submit", function (udalost) {
      udalost.preventDefault();
      var text = textarea.value.trim();
      if (!text) return;
      tlacitko.disabled = true;
      GH.zmen("aktivita", function (polozky) {
        polozky.push({
          id: GH.noveId("akt"),
          entita: "casosber",
          entita_id: mistoId,
          druh: "komentar",
          text: text,
          kdo: mojeId(),
          kdy: new Date().toISOString(),
          smazano: null
        });
      })
        .then(function (obsah) {
          App.uloz("aktivita", obsah);
          otevreneKomentare[mistoId] = true;
          App.toast("Komentář přidán.", "ok");
          App.prekresli();
        })
        .catch(function (chyba) {
          chybaZapisu(chyba, "Přidání komentáře selhalo.");
          tlacitko.disabled = false;
        });
    });

    return form;
  }

  // ------------------------------------------------------------------
  // Fotka místa — zmenšení, náhled, tři cesty k přidání, odebrání
  // ------------------------------------------------------------------

  // Načtení fotky ze souboru do něčeho, co jde nakreslit na canvas.
  // createImageBitmap s imageOrientation:"from-image" srovná EXIF otočení
  // (fotky z telefonu jsou skoro vždy otočené); když ho prohlížeč neumí,
  // spadneme na obyčejný <img>.
  function nactiKresliciZdroj(soubor) {
    function pres_img() {
      return new Promise(function (hotovo, selhalo) {
        var url = URL.createObjectURL(soubor);
        var obrazek = new Image();
        obrazek.onload = function () {
          URL.revokeObjectURL(url);
          hotovo(obrazek);
        };
        obrazek.onerror = function () {
          URL.revokeObjectURL(url);
          selhalo(new Error("Obrázek se nepodařilo načíst."));
        };
        obrazek.src = url;
      });
    }
    if (typeof window.createImageBitmap !== "function") {
      return pres_img();
    }
    return Promise.resolve()
      .then(function () {
        return window.createImageBitmap(soubor, { imageOrientation: "from-image" });
      })
      .catch(function () {
        return window.createImageBitmap(soubor);
      })
      .catch(pres_img);
  }

  function maxStranaPx() {
    return jeDemoRezim() ? MAX_STRANA_DEMO_PX : MAX_STRANA_PX;
  }

  // Zmenší fotku v prohlížeči na maxStranaPx() delší strany a překóduje
  // na JPEG. Vrací { blob, sirka, vyska }.
  function zmensiFotku(soubor) {
    var mez = maxStranaPx();
    return nactiKresliciZdroj(soubor).then(function (zdroj) {
      var sirkaZdroje = zdroj.width || zdroj.naturalWidth || 0;
      var vyskaZdroje = zdroj.height || zdroj.naturalHeight || 0;
      if (!sirkaZdroje || !vyskaZdroje) {
        throw new Error("Fotka nemá rozměry.");
      }
      var pomer = Math.min(1, mez / Math.max(sirkaZdroje, vyskaZdroje));
      var sirka = Math.max(1, Math.round(sirkaZdroje * pomer));
      var vyska = Math.max(1, Math.round(vyskaZdroje * pomer));

      var platno = document.createElement("canvas");
      platno.width = sirka;
      platno.height = vyska;
      var kontext = platno.getContext("2d");
      if (!kontext) {
        throw new Error("Prohlížeč neumí canvas.");
      }
      kontext.drawImage(zdroj, 0, 0, sirka, vyska);
      if (typeof zdroj.close === "function") zdroj.close();

      return new Promise(function (hotovo, selhalo) {
        platno.toBlob(
          function (blob) {
            if (!blob) {
              selhalo(new Error("Zmenšení fotky selhalo."));
              return;
            }
            hotovo({ blob: blob, sirka: sirka, vyska: vyska });
          },
          "image/jpeg",
          KVALITA_JPEG
        );
      });
    });
  }

  function blobNaDataUrl(blob) {
    return new Promise(function (hotovo, selhalo) {
      var ctecka = new FileReader();
      ctecka.onload = function () {
        hotovo(String(ctecka.result));
      };
      ctecka.onerror = function () {
        selhalo(new Error("Fotku se nepodařilo přečíst."));
      };
      ctecka.readAsDataURL(blob);
    });
  }

  // Nastaví do <img> správný zdroj podle modelu fotky. Vrací true, když se
  // opravdu něco zobrazuje; jinak si volající do stavového prvku napíše svoje.
  // `mistniSrc` je čerstvě zmenšená fotka, která ještě nikde neleží.
  function nastavFotkuDoObrazku(fotka, obrazek, stavovyPrvek, mistniSrc) {
    function primo(src, chybovyText) {
      obrazek.onerror = function () {
        obrazek.onerror = null;
        obrazek.hidden = true;
        stavovyPrvek.hidden = false;
        stavovyPrvek.textContent = chybovyText;
      };
      obrazek.src = src;
      obrazek.hidden = false;
      stavovyPrvek.hidden = true;
    }

    function chybi(text) {
      obrazek.hidden = true;
      stavovyPrvek.hidden = false;
      stavovyPrvek.textContent = text;
      return false;
    }

    if (mistniSrc) {
      primo(mistniSrc, "Náhled se nepodařilo zobrazit.");
      return true;
    }

    var f = fotka || prazdnaFotka();

    if (f.zdroj === "nalet") {
      var snimek = f.foto_id ? snimekPodleId(f.foto_id) : null;
      if (!snimek) return chybi("Snímek z náletu se nenašel.");
      stavovyPrvek.textContent = "Načítám náhled…";
      nactiObrazekDo(snimek.nahled, obrazek, stavovyPrvek);
      return true;
    }
    if (f.zdroj === "repo") {
      if (!f.cesta) return chybi("Fotka nemá cestu.");
      stavovyPrvek.textContent = "Načítám náhled…";
      nactiObrazekDo(f.cesta, obrazek, stavovyPrvek);
      return true;
    }
    if (f.zdroj === "url") {
      var odkaz = Util.bezpecnyOdkaz(f.cesta);
      if (!odkaz || odkaz.slice(0, 8).toLowerCase() !== "https://") {
        return chybi("Odkaz na fotku není platný (musí začínat https://).");
      }
      primo(odkaz, "Fotku z odkazu se nepodařilo načíst.");
      return true;
    }
    if (f.zdroj === "data") {
      if (String(f.cesta).slice(0, 11) !== "data:image/") {
        return chybi("Uloženou fotku se nepodařilo přečíst.");
      }
      primo(f.cesta, "Fotku se nepodařilo zobrazit.");
      return true;
    }
    return false;
  }

  // Náhled fotky, na který se dá kliknout a zvětšit ho. Vrací obal i <img>,
  // ať si volající může doplnit svoje hlášky.
  function vytvorKlikaciNahled(fotka, mistniSrc, nadpisZvetseniny) {
    // Obal NESMÍ být `hidden`, dokud se obrázek nenačte: obrázek s
    // loading="lazy" uvnitř display:none rodiče se v prohlížeči nezačne
    // stahovat nikdy (a čekání na jeho `load` by se tím zacyklilo).
    // Dokud fotka není, je obal prostě nulově vysoký a mimo pořadí tabulátoru.
    var tlacitko = document.createElement("button");
    tlacitko.type = "button";
    tlacitko.title = "Zvětšit fotku";
    tlacitko.tabIndex = -1;
    tlacitko.style.cssText =
      "display:block;width:100%;padding:0;border:0;background:none;cursor:default";

    var obrazek = document.createElement("img");
    obrazek.alt = "";
    obrazek.loading = "lazy";
    obrazek.decoding = "async";
    obrazek.hidden = true;
    obrazek.style.maxHeight = "200px";
    obrazek.style.objectFit = "cover";
    tlacitko.appendChild(obrazek);

    var stav = document.createElement("p");
    stav.className = "cas-foto-stav";
    stav.textContent = "Načítám náhled…";

    obrazek.addEventListener("load", function () {
      tlacitko.tabIndex = 0;
      tlacitko.style.cursor = "zoom-in";
      tlacitko.setAttribute("aria-label", "Zvětšit fotku");
    });
    tlacitko.addEventListener("click", function () {
      if (!obrazek.src || obrazek.hidden) return;
      otevriZvetseninu(nadpisZvetseniny, fotka, obrazek.src);
    });

    var zobrazeno = nastavFotkuDoObrazku(fotka, obrazek, stav, mistniSrc);
    return { tlacitko: tlacitko, obrazek: obrazek, stav: stav, zobrazeno: zobrazeno };
  }

  // Zvětšenina v modálu. U snímku z náletu se dotáhne velká verze (1400 px).
  function otevriZvetseninu(nadpis, fotka, aktualniSrc) {
    var obal = document.createElement("div");
    obal.className = "detail-obrazek";

    var obrazek = document.createElement("img");
    obrazek.alt = "";
    obrazek.decoding = "async";
    if (aktualniSrc) obrazek.src = aktualniSrc;
    obal.appendChild(obrazek);

    var stav = document.createElement("p");
    stav.className = "cas-foto-stav";
    stav.textContent = "Načítám fotku…";
    stav.hidden = !!aktualniSrc;
    obal.appendChild(stav);

    var modal = App.modal({
      nadpis: nadpis || "Fotka",
      obsah: obal,
      akce: [
        {
          text: "Zavřít",
          druh: "sekundarni",
          fn: function () {
            modal.zavri();
          }
        }
      ]
    });

    var f = fotka || prazdnaFotka();
    if (f.zdroj === "nalet" && f.foto_id && window.GH && typeof GH.nactiSoubor === "function") {
      var snimek = snimekPodleId(f.foto_id);
      if (snimek) {
        GH.nactiSoubor(snimek.velky)
          .then(function (src) {
            if (src) {
              obrazek.src = src;
              stav.hidden = true;
            } else if (!aktualniSrc) {
              stav.textContent = "Fotku se nepodařilo načíst.";
            }
          })
          .catch(function (chyba) {
            console.warn("Časosběr — zvětšenina selhala:", chyba);
            if (!aktualniSrc) stav.textContent = "Fotku se nepodařilo načíst.";
          });
      }
    }
    return modal;
  }

  // Postupné načítání náhledů mimo hlavní mřížku (výběr z náletu v modálu).
  // Vlastní instance pozorovatele, ať to nesahá na tu modulovou.
  function postupneNacitani(korene) {
    if (typeof window.IntersectionObserver !== "function") {
      korene.forEach(function (zaznam) {
        nactiObrazekDo(zaznam.cesta, zaznam.obrazek, zaznam.stav);
      });
      return null;
    }
    var podleElementu = new Map();
    var pozorovatel = new window.IntersectionObserver(
      function (zaznamy, kdo) {
        zaznamy.forEach(function (zaznam) {
          if (!zaznam.isIntersecting) return;
          var data = podleElementu.get(zaznam.target);
          kdo.unobserve(zaznam.target);
          if (data) nactiObrazekDo(data.cesta, data.obrazek, data.stav);
        });
      },
      { rootMargin: "300px 0px" }
    );
    korene.forEach(function (zaznam) {
      podleElementu.set(zaznam.prvek, zaznam);
      pozorovatel.observe(zaznam.prvek);
    });
    return pozorovatel;
  }

  // Výběr snímku z náletu jako fotky pro už existující místo (§A.3 řeší
  // opačný směr — založení místa ze snímku).
  function otevriVyberZNaletu(naVyber) {
    var mistniFiltr = aktivniFiltr;
    var pozorovatel = null;

    var obsah = document.createElement("div");

    var napoveda = document.createElement("p");
    napoveda.className = "napoveda";
    napoveda.textContent = "Klikni na snímek a použije se jako fotka místa.";
    obsah.appendChild(napoveda);

    var pruhFiltru = document.createElement("div");
    obsah.appendChild(pruhFiltru);

    var pocitadlo = document.createElement("p");
    pocitadlo.className = "karta-meta";
    obsah.appendChild(pocitadlo);

    var mrizka = document.createElement("div");
    mrizka.className = "galerie-mrizka";
    obsah.appendChild(mrizka);

    function uklid() {
      if (pozorovatel) {
        pozorovatel.disconnect();
        pozorovatel = null;
      }
    }

    function prekresli() {
      uklid();
      pruhFiltru.textContent = "";
      pruhFiltru.appendChild(
        vytvorFiltr(mistniFiltr, function (kod) {
          mistniFiltr = kod;
          prekresli();
        })
      );
      mrizka.textContent = "";

      var kNacteni = [];
      var pocet = 0;
      SNIMKY.forEach(function (snimek, index) {
        if (!projdeFiltrem(snimek, mistniFiltr)) return;
        pocet++;
        mrizka.appendChild(
          vytvorDlazdici(snimek, index, kNacteni, function () {
            modal.zavri();
            naVyber(snimek, index);
          })
        );
      });

      pocitadlo.textContent = "Zobrazeno " + pocet + " ze " + SNIMKY.length + " snímků.";
      if (!pocet) {
        var prazdno = document.createElement("div");
        prazdno.className = "prazdny-stav";
        var text = document.createElement("p");
        text.className = "prazdny-stav-text";
        text.textContent = "Tomuto filtru neodpovídá žádný snímek.";
        prazdno.appendChild(text);
        mrizka.appendChild(prazdno);
        return;
      }
      pozorovatel = postupneNacitani(kNacteni);
    }

    prekresli();

    var modal = App.modal({
      nadpis: "Vybrat snímek z náletu",
      obsah: obsah,
      naZavreni: uklid,
      akce: [
        {
          text: "Zrušit",
          druh: "sekundarni",
          fn: function () {
            modal.zavri();
          }
        }
      ]
    });
    return modal;
  }

  // Jedna ze tří karet „jak k místu dostat fotku".
  function vytvorVolbuFotky(nadpisText, popisText) {
    var karta = document.createElement("div");
    karta.className = "karta";
    karta.style.padding = "10px 12px";
    karta.style.minWidth = "0";

    var nadpis = document.createElement("h5");
    nadpis.className = "karta-nadpis";
    nadpis.textContent = nadpisText;
    karta.appendChild(nadpis);

    var popis = document.createElement("p");
    popis.className = "napoveda";
    popis.textContent = popisText;
    karta.appendChild(popis);

    return karta;
  }

  // Blok „Fotka" — náhled, odebrání a tři cesty, jak fotku přidat.
  // `stav` = { fotka, blob, nahledSrc } se mění NA MÍSTĚ, volající si po
  // uložení přečte výsledek. Používá ho jak úprava místa, tak samostatný
  // modál z karty. Celý blok je pod právem casosber.upravit.
  // `moznosti.idMista` je povinné — z něj se skládá cesta k souboru v repu.
  function vytvorBlokFotky(stav, moznosti) {
    moznosti = moznosti || {};

    var obal = document.createElement("div");
    obal.className = "pole cas-foto-blok";

    var popisek = document.createElement("label");
    popisek.textContent = "Fotka";
    obal.appendChild(popisek);

    var nahled = document.createElement("div");
    nahled.className = "cas-misto-foto";
    obal.appendChild(nahled);

    var radekAkci = document.createElement("div");
    radekAkci.className = "karta-akce";
    obal.appendChild(radekAkci);

    var chybaFotky = document.createElement("p");
    chybaFotky.className = "formular-chyba";
    chybaFotky.hidden = true;
    obal.appendChild(chybaFotky);

    function ukazChybu(text) {
      chybaFotky.textContent = text;
      chybaFotky.hidden = false;
    }

    function skryjChybu() {
      chybaFotky.hidden = true;
      chybaFotky.textContent = "";
    }

    function popisZdroje() {
      var f = stav.fotka;
      if (f.zdroj === "nalet") {
        var cislo = cisloSnimku(f.foto_id);
        return cislo ? "Snímek #" + cislo + " z náletu" : "Snímek z náletu";
      }
      if (f.zdroj === "repo") {
        return stav.blob ? "Nahraná fotka — uloží se tlačítkem Uložit" : "Nahraná fotka v datovém repu";
      }
      if (f.zdroj === "data") return "Nahraná fotka — v demu jen v tomto prohlížeči";
      if (f.zdroj === "url") return "Fotka z odkazu";
      return "";
    }

    function prekresliNahled() {
      nahled.textContent = "";
      radekAkci.textContent = "";

      var prvky = vytvorKlikaciNahled(stav.fotka, stav.nahledSrc, "Fotka místa");
      nahled.appendChild(prvky.tlacitko);
      nahled.appendChild(prvky.stav);
      if (!prvky.zobrazeno && !stav.fotka.zdroj) {
        prvky.stav.hidden = false;
        prvky.stav.textContent = "Zatím bez fotky.";
      }

      if (stav.fotka.zdroj) {
        var odebrat = document.createElement("button");
        odebrat.type = "button";
        odebrat.className = "btn btn-mala btn-nebezpecny";
        odebrat.textContent = "Odebrat fotku";
        odebrat.addEventListener("click", function () {
          App.potvrd("Odebrat fotku od tohoto místa? Soubor v repu zůstane, jen se od místa odpojí.").then(
            function (ano) {
              if (!ano) return;
              stav.fotka = prazdnaFotka();
              stav.blob = null;
              stav.nahledSrc = "";
              vstupOdkazu.value = "";
              vstupSouboru.value = "";
              skryjChybu();
              prekresliNahled();
            }
          );
        });
        radekAkci.appendChild(odebrat);

        var meta = document.createElement("span");
        meta.className = "karta-meta";
        meta.textContent = popisZdroje();
        radekAkci.appendChild(meta);
      }
    }

    // ---- tři cesty vedle sebe ----

    var volby = document.createElement("div");
    volby.style.display = "grid";
    volby.style.gap = "10px";
    volby.style.gridTemplateColumns = "repeat(auto-fit, minmax(160px, 1fr))";
    obal.appendChild(volby);

    // a) nahrát ze souboru
    var volbaSoubor = vytvorVolbuFotky(
      "Nahrát ze souboru",
      "Z telefonu nebo z počítače. Zmenší se na " +
        maxStranaPx() +
        " px delší strany, limit " +
        LIMIT_FOTKY_MB +
        " MB." +
        (jeDemoRezim() ? " V demu zůstane jen ve tvém prohlížeči." : "")
    );
    var vstupSouboru = document.createElement("input");
    vstupSouboru.type = "file";
    vstupSouboru.accept = "image/*";
    vstupSouboru.setAttribute("aria-label", "Nahrát fotku ze souboru");
    vstupSouboru.style.width = "100%";
    vstupSouboru.style.maxWidth = "100%";
    vstupSouboru.style.boxSizing = "border-box";
    vstupSouboru.addEventListener("change", function () {
      var soubor = vstupSouboru.files && vstupSouboru.files[0];
      if (soubor) prevezmiSoubor(soubor);
    });
    volbaSoubor.appendChild(vstupSouboru);
    volby.appendChild(volbaSoubor);

    function prevezmiSoubor(soubor) {
      skryjChybu();
      var mb = soubor.size / (1024 * 1024);
      if (mb > LIMIT_FOTKY_MB) {
        vstupSouboru.value = "";
        ukazChybu("Fotka má " + cesky(mb, 1) + " MB, limit je " + LIMIT_FOTKY_MB + " MB. Zmenši ji.");
        return;
      }
      if (soubor.type && soubor.type.slice(0, 6) !== "image/") {
        vstupSouboru.value = "";
        ukazChybu("Tohle není obrázek — vyber fotku (JPEG nebo PNG).");
        return;
      }
      vstupSouboru.disabled = true;
      zmensiFotku(soubor)
        .then(function (vysledek) {
          return blobNaDataUrl(vysledek.blob).then(function (dataUrl) {
            stav.nahledSrc = dataUrl;
            if (jeDemoRezim()) {
              // demo: nikam se nenahrává, fotka žije jako data: URL
              stav.blob = null;
              stav.fotka = { zdroj: "data", cesta: dataUrl, foto_id: null };
              App.toast("V demu zůstane fotka jen ve tvém prohlížeči.", "info");
            } else {
              stav.blob = vysledek.blob;
              stav.fotka = { zdroj: "repo", cesta: cestaFotkyVRepu(moznosti.idMista), foto_id: null };
            }
            vstupOdkazu.value = "";
            prekresliNahled();
          });
        })
        .catch(function (chyba) {
          console.warn("Časosběr — zpracování fotky selhalo:", chyba);
          vstupSouboru.value = "";
          ukazChybu("Fotku se nepodařilo zpracovat. Zkus jinou nebo ji ulož jako JPEG.");
        })
        .then(function () {
          vstupSouboru.disabled = false;
        });
    }

    // b) vybrat z náletu
    var volbaNalet = vytvorVolbuFotky(
      "Vybrat z náletu",
      SNIMKY.length + " snímků z 26. 8. 2026 — ty samé, které jsou v galerii dole."
    );
    var tlacitkoNalet = document.createElement("button");
    tlacitkoNalet.type = "button";
    tlacitkoNalet.className = "btn btn-mala btn-sekundarni";
    tlacitkoNalet.textContent = "Otevřít galerii";
    tlacitkoNalet.addEventListener("click", function () {
      otevriVyberZNaletu(function (snimek) {
        skryjChybu();
        stav.blob = null;
        stav.nahledSrc = "";
        stav.fotka = { zdroj: "nalet", cesta: "", foto_id: snimek.id };
        vstupOdkazu.value = "";
        vstupSouboru.value = "";
        prekresliNahled();
      });
    });
    volbaNalet.appendChild(tlacitkoNalet);
    volby.appendChild(volbaNalet);

    // c) odkaz
    var volbaOdkaz = vytvorVolbuFotky("Odkaz", "Adresa fotky na webu. Jen taková, která začíná https://");
    var vstupOdkazu = document.createElement("input");
    vstupOdkazu.type = "text";
    vstupOdkazu.placeholder = "https://…";
    vstupOdkazu.setAttribute("aria-label", "Odkaz na fotku");
    vstupOdkazu.value = stav.fotka.zdroj === "url" ? stav.fotka.cesta : "";
    vstupOdkazu.style.width = "100%";
    vstupOdkazu.style.boxSizing = "border-box";
    vstupOdkazu.addEventListener("change", function () {
      pouzijOdkaz();
    });
    volbaOdkaz.appendChild(vstupOdkazu);
    var tlacitkoOdkaz = document.createElement("button");
    tlacitkoOdkaz.type = "button";
    tlacitkoOdkaz.className = "btn btn-mala btn-sekundarni";
    tlacitkoOdkaz.textContent = "Použít odkaz";
    tlacitkoOdkaz.addEventListener("click", function () {
      pouzijOdkaz();
    });
    volbaOdkaz.appendChild(tlacitkoOdkaz);
    volby.appendChild(volbaOdkaz);

    // Vrací true, když je pole odkazu v pořádku (prázdné, nebo platné https).
    function pouzijOdkaz() {
      var hodnota = vstupOdkazu.value.trim();
      if (!hodnota) {
        if (stav.fotka.zdroj === "url") {
          stav.fotka = prazdnaFotka();
          prekresliNahled();
        }
        skryjChybu();
        return true;
      }
      var bezpecny = Util.bezpecnyOdkaz(hodnota);
      if (!bezpecny || bezpecny.slice(0, 8).toLowerCase() !== "https://") {
        ukazChybu("Použij odkaz začínající https://");
        vstupOdkazu.focus();
        return false;
      }
      skryjChybu();
      if (stav.fotka.zdroj !== "url" || stav.fotka.cesta !== bezpecny) {
        stav.blob = null;
        stav.nahledSrc = "";
        stav.fotka = { zdroj: "url", cesta: bezpecny, foto_id: null };
        vstupSouboru.value = "";
        prekresliNahled();
      }
      return true;
    }

    prekresliNahled();

    return {
      prvek: obal,
      // vrací false, když je v poli odkazu nesmysl (volající neuloží)
      potvrdOdkaz: pouzijOdkaz
    };
  }

  // Nahraje čekající soubor do privátního repa. V demu se sem nikdy
  // nedostaneme (tam je zdroj "data"), takže se na síť nesáhne.
  function nahrajCekajiciSoubor(stav, idMista) {
    if (!stav.blob || stav.fotka.zdroj !== "repo") return Promise.resolve(true);
    if (!window.GH || typeof GH.nahrajSoubor !== "function") {
      return Promise.reject(chybaSHlaskou("Nahrávání fotek není v této verzi k dispozici."));
    }
    var cesta = cestaFotkyVRepu(idMista);
    stav.fotka = { zdroj: "repo", cesta: cesta, foto_id: null };
    return GH.nahrajSoubor(cesta, stav.blob, "kokpit: fotka místa pro časosběrnou kameru (" + idMista + ")").then(
      function (ok) {
        if (!ok) {
          throw chybaSHlaskou("Fotku se nepodařilo nahrát do datového repa. Zkontroluj přístup a zkus to znovu.");
        }
        // ať se karta překreslí rovnou z toho, co jsme právě nahráli,
        // a netahalo se to hned zpátky přes API
        obrazkyVPameti.set(cesta, stav.nahledSrc || null);
        stav.blob = null;
        return true;
      }
    );
  }

  // Samostatný modál „Fotka místa" z karty — nahrání/výběr/odkaz i odebrání.
  function otevriFotkuMista(misto) {
    if (!smiUpravit()) return;

    var stav = { fotka: fotkaMista(misto), blob: null, nahledSrc: "" };
    var blok = vytvorBlokFotky(stav, { idMista: misto.id });

    var obal = document.createElement("div");
    obal.className = "formular";
    obal.appendChild(blok.prvek);

    var modal = App.modal({
      nadpis: "Fotka místa — " + (misto.nazev || "bez názvu"),
      obsah: obal,
      akce: [
        {
          text: "Zrušit",
          druh: "sekundarni",
          fn: function () {
            modal.zavri();
          }
        },
        {
          text: "Uložit",
          druh: "primarni",
          fn: function () {
            uloz();
          }
        }
      ]
    });

    function uloz() {
      if (!blok.potvrdOdkaz()) return;
      nahrajCekajiciSoubor(stav, misto.id)
        .then(function () {
          return zmenCasosber(function (obalka) {
            var polozka = najdiPodleId(obalka.polozky, misto.id);
            if (!polozka) return;
            zapisFotkuDoPolozky(polozka, stav.fotka);
          }, (stav.fotka.zdroj ? "Fotka místa: " : "Odebrána fotka místa: ") + (misto.nazev || ""));
        })
        .then(function (obsah) {
          // Když se fotka v demu do localStorage nevešla, dostal člověk
          // vysvětlující hlášku — nepřekřikneme ji zeleným „Uloženo".
          var veslo = overDemoUlozeni(stav.fotka);
          modal.zavri();
          poUlozeni(obsah, veslo ? (stav.fotka.zdroj ? "Fotka uložena." : "Fotka odebrána.") : null);
        })
        .catch(function (chyba) {
          chybaZapisu(chyba, "Uložení fotky selhalo.");
        });
    }
  }

  // Odebrání fotky rovnou z karty. Soubor v repu se NEMAŽE — může na něj
  // odkazovat něco jiného, jen se od místa odpojí.
  function odeberFotkuMista(misto) {
    if (!smiUpravit()) return;
    App.potvrd(
      'Odebrat fotku od místa „' + (misto.nazev || "bez názvu") + '"? Soubor v repu zůstane, jen se od místa odpojí.'
    ).then(function (ano) {
      if (!ano) return;
      zmenCasosber(function (obalka) {
        var polozka = najdiPodleId(obalka.polozky, misto.id);
        if (!polozka) return;
        zapisFotkuDoPolozky(polozka, prazdnaFotka());
      }, "Odebrána fotka místa: " + (misto.nazev || ""))
        .then(function (obsah) {
          poUlozeni(obsah, "Fotka odebrána.");
        })
        .catch(function (chyba) {
          chybaZapisu(chyba, "Odebrání fotky selhalo.");
        });
    });
  }

  // ------------------------------------------------------------------
  // Karta vybraného místa
  // ------------------------------------------------------------------

  function radekUdaje(popisek, hodnota) {
    if (!hodnota) return null;
    var radek = document.createElement("p");
    radek.className = "cas-udaj";
    var label = document.createElement("span");
    label.className = "cas-udaj-popisek";
    label.textContent = popisek;
    radek.appendChild(label);
    var text = document.createElement("span");
    text.className = "cas-udaj-hodnota";
    text.textContent = hodnota;
    radek.appendChild(text);
    return radek;
  }

  // Řádek se štítkem stavu: popisek · štítek · volný popis.
  // Používá se pro Přístup, Napájení 230 V a Internet.
  function radekSeStitkem(popisek, nazevStitku, tridaStitku, hodnota) {
    var radek = document.createElement("div");
    radek.className = "cas-udaj";

    var label = document.createElement("span");
    label.className = "cas-udaj-popisek";
    label.textContent = popisek;
    radek.appendChild(label);

    var stitek = document.createElement("span");
    stitek.className = "stitek " + tridaStitku;
    stitek.textContent = nazevStitku;
    radek.appendChild(stitek);

    if (hodnota) {
      var text = document.createElement("span");
      text.className = "cas-udaj-hodnota";
      text.textContent = hodnota;
      radek.appendChild(text);
    }

    return radek;
  }

  // Tři řádky, které rozhodují o tom, jestli se dá kamera osadit:
  // s kým je domluvený přístup, jestli je na místě proud a jestli je
  // tam připojení. Zadání Františka ze srpna 2026.
  function vytvorRadkyPripojeni(misto) {
    var obal = document.createElement("div");
    obal.className = "cas-misto-udaje";

    var pristupCasti = [];
    if (misto.jedna_s) pristupCasti.push(misto.jedna_s);
    var popisPristupu = pristupPopisMista(misto);
    if (popisPristupu) pristupCasti.push(popisPristupu);
    obal.appendChild(
      radekSeStitkem(
        "Přístup",
        nazevStavu(misto.stav),
        tridaStavu(misto.stav),
        pristupCasti.join(" · ")
      )
    );

    var napajeni = napajeniMista(misto);
    var polozkaNapajeni = polozkaCiselniku(STAVY_NAPAJENI, napajeni.stav);
    obal.appendChild(
      radekSeStitkem("Napájení 230 V", polozkaNapajeni.nazev, polozkaNapajeni.trida, napajeni.popis)
    );

    var internet = internetMista(misto);
    var polozkaInternetu = polozkaCiselniku(STAVY_INTERNETU, internet.stav);
    obal.appendChild(
      radekSeStitkem("Internet", polozkaInternetu.nazev, polozkaInternetu.trida, internet.popis)
    );

    return obal;
  }

  function vytvorFotkuMista(misto) {
    var obal = document.createElement("div");
    obal.className = "cas-misto-foto";

    var fotka = fotkaMista(misto);
    var prvky = vytvorKlikaciNahled(fotka, "", "Fotka místa — " + (misto.nazev || "bez názvu"));
    obal.appendChild(prvky.tlacitko);
    obal.appendChild(prvky.stav);

    if (!fotka.zdroj) {
      // Čtenář nemá vidět pobídku k něčemu, co stejně nesmí (KONTRAKT.md §5).
      prvky.stav.hidden = false;
      prvky.stav.textContent = smiUpravit() ? "Bez fotky — přidej ji tlačítkem Upravit" : "Bez fotky";
    }

    if (fotka.zdroj === "nalet" && fotka.foto_id && snimekPodleId(fotka.foto_id)) {
      var odkazNaSnimek = document.createElement("button");
      odkazNaSnimek.type = "button";
      odkazNaSnimek.className = "btn btn-mala btn-sekundarni cas-misto-foto-odkaz";
      odkazNaSnimek.textContent = "Snímek #" + cisloSnimku(fotka.foto_id);
      odkazNaSnimek.addEventListener("click", function () {
        otevriDetailSnimku(fotka.foto_id);
      });
      obal.appendChild(odkazNaSnimek);
    }

    if (smiUpravit()) {
      var akce = document.createElement("div");
      akce.className = "karta-akce";

      var zmenit = document.createElement("button");
      zmenit.type = "button";
      zmenit.className = "btn btn-mala btn-sekundarni";
      zmenit.textContent = fotka.zdroj ? "Změnit fotku" : "Přidat fotku";
      zmenit.addEventListener("click", function () {
        otevriFotkuMista(misto);
      });
      akce.appendChild(zmenit);

      if (fotka.zdroj) {
        var odebrat = document.createElement("button");
        odebrat.type = "button";
        odebrat.className = "btn btn-mala btn-nebezpecny";
        odebrat.textContent = "Odebrat fotku";
        odebrat.addEventListener("click", function () {
          odeberFotkuMista(misto);
        });
        akce.appendChild(odebrat);
      }

      obal.appendChild(akce);
    }

    return obal;
  }

  function vytvorKartuMista(misto, poradiVSeznamu) {
    var karta = document.createElement("article");
    karta.className = "karta cas-misto " + tridaStavu(misto.stav);
    karta.id = "misto-" + misto.id;

    var hlavicka = document.createElement("div");
    hlavicka.className = "karta-hlavicka";

    var nadpis = document.createElement("h4");
    nadpis.className = "karta-nadpis";
    nadpis.textContent = poradiVSeznamu + " · " + (misto.nazev || "(bez názvu)");
    hlavicka.appendChild(nadpis);

    var stitek = document.createElement("span");
    stitek.className = "stitek " + tridaStavu(misto.stav);
    stitek.textContent = nazevStavu(misto.stav);
    hlavicka.appendChild(stitek);

    karta.appendChild(hlavicka);

    var telo = document.createElement("div");
    telo.className = "cas-misto-telo";

    telo.appendChild(vytvorFotkuMista(misto));

    var udaje = document.createElement("div");
    udaje.className = "cas-misto-udaje";

    if (misto.popis) {
      var popis = document.createElement("p");
      popis.className = "karta-popis";
      popis.textContent = misto.popis;
      udaje.appendChild(popis);
    }

    udaje.appendChild(blokVysky(misto.vyska_nad_terenem_m, misto.nadmorska_vyska_m));

    [
      radekUdaje("Směr pohledu", misto.smer_pohledu),
      radekUdaje(
        "Vzdálenost k objektu",
        jeCislo(misto.vzdalenost_k_objektu_m) ? cesky(misto.vzdalenost_k_objektu_m, 0) + " m" : ""
      ),
      radekUdaje("Kamera", misto.kamera),
      radekUdaje(
        "Souřadnice",
        misto.bod && Mapa.platnyBod(misto.bod.lat, misto.bod.lon)
          ? Mapa.souradnice(misto.bod.lat, misto.bod.lon)
          : ""
      )
    ].forEach(function (radek) {
      if (radek) udaje.appendChild(radek);
    });

    if (misto.poznamka) {
      var poznamka = document.createElement("p");
      poznamka.className = "cas-poznamka";
      poznamka.textContent = misto.poznamka;
      udaje.appendChild(poznamka);
    }

    telo.appendChild(udaje);

    var mapaObal = document.createElement("div");
    mapaObal.className = "cas-misto-mapa";
    if (misto.bod && Mapa.platnyBod(misto.bod.lat, misto.bod.lon)) {
      var kontejnerMapy = document.createElement("div");
      kontejnerMapy.className = "mapa mapa-mala";
      mapaObal.appendChild(kontejnerMapy);
      var instance = Mapa.vytvor(kontejnerMapy, {
        lat: misto.bod.lat,
        lon: misto.bod.lon,
        zoom: Mapa.ZOOM_VYCHOZI,
        popisek: "Mapa místa " + (misto.nazev || "")
      });
      if (instance) zivyMapy.push(instance);
    } else {
      var bezBodu = document.createElement("p");
      bezBodu.className = "karta-meta";
      bezBodu.textContent = "Poloha zatím není určena — doplní se v úpravě místa nebo výběrem snímku z galerie.";
      mapaObal.appendChild(bezBodu);
    }
    telo.appendChild(mapaObal);

    karta.appendChild(telo);

    // Přístup / napájení / internet — mimo mřížku těla, ať jsou tři řádky
    // vedle sebe přes celou kartu a daly se přečíst jedním pohledem.
    karta.appendChild(vytvorRadkyPripojeni(misto));

    var akce = document.createElement("div");
    akce.className = "karta-akce";

    // Kopírování je čtení, ne úprava — má ho i čtenář.
    var kopirovat = document.createElement("button");
    kopirovat.type = "button";
    kopirovat.className = "btn btn-mala btn-sekundarni";
    kopirovat.textContent = "Kopírovat dotaz pro stavbu";
    kopirovat.addEventListener("click", function () {
      zkopirujDotazProStavbu(misto);
    });
    akce.appendChild(kopirovat);

    if (smiUpravit()) {
      var pripojeni = document.createElement("button");
      pripojeni.type = "button";
      pripojeni.className = "btn btn-mala btn-sekundarni";
      pripojeni.textContent = "Přístup, napájení, internet";
      pripojeni.addEventListener("click", function () {
        otevriFormularPripojeni(misto);
      });
      akce.appendChild(pripojeni);

      var upravit = document.createElement("button");
      upravit.type = "button";
      upravit.className = "btn btn-mala btn-sekundarni";
      upravit.textContent = "Upravit";
      upravit.addEventListener("click", function () {
        otevriFormularMista(misto);
      });
      akce.appendChild(upravit);

      var smazat = document.createElement("button");
      smazat.type = "button";
      smazat.className = "btn btn-mala btn-nebezpecny";
      smazat.textContent = "Smazat";
      smazat.addEventListener("click", function () {
        smazMisto(misto);
      });
      akce.appendChild(smazat);
    }

    karta.appendChild(akce);

    karta.appendChild(vytvorKomentare(misto.id));

    return karta;
  }

  // ------------------------------------------------------------------
  // Formulář místa — přidání i úprava (právo casosber.upravit)
  // ------------------------------------------------------------------

  function poleText(formular, nazev, popisek, hodnota, typ) {
    var pole = document.createElement("div");
    pole.className = "pole";
    var label = document.createElement("label");
    var id = "cas-pole-" + nazev;
    label.setAttribute("for", id);
    label.textContent = popisek;
    pole.appendChild(label);
    var vstup = document.createElement(typ === "textarea" ? "textarea" : "input");
    vstup.id = id;
    vstup.name = nazev;
    if (typ === "textarea") {
      vstup.rows = 3;
    } else {
      vstup.type = typ || "text";
    }
    vstup.value = hodnota === null || hodnota === undefined ? "" : String(hodnota);
    pole.appendChild(vstup);
    formular.appendChild(pole);
    return vstup;
  }

  function otevriFormularMista(mistoParam) {
    if (!smiUpravit()) return;
    var jeNove = !mistoParam;
    var misto = mistoParam || {};

    var formular = document.createElement("form");
    formular.className = "formular";

    var vstupNazev = poleText(formular, "nazev", "Název místa", misto.nazev || "");
    vstupNazev.required = true;

    var poleStav = document.createElement("div");
    poleStav.className = "pole";
    var labelStav = document.createElement("label");
    labelStav.setAttribute("for", "cas-pole-stav");
    labelStav.textContent = "Stav";
    poleStav.appendChild(labelStav);
    var vyberStav = document.createElement("select");
    vyberStav.id = "cas-pole-stav";
    vyberStav.name = "stav";
    STAVY.forEach(function (s) {
      var volba = document.createElement("option");
      volba.value = s.kod;
      volba.textContent = s.nazev;
      if ((misto.stav || "navrzeno") === s.kod) volba.selected = true;
      vyberStav.appendChild(volba);
    });
    poleStav.appendChild(vyberStav);
    formular.appendChild(poleStav);

    var vstupPopis = poleText(formular, "popis", "Popis místa", misto.popis || "", "textarea");
    var vstupJednaS = poleText(formular, "jedna-s", "S kým se jedná o přístup", misto.jedna_s || "");
    var vstupKamera = poleText(formular, "kamera", "Zvolená kamera", misto.kamera || "");
    var vstupSmer = poleText(formular, "smer", "Směr pohledu", misto.smer_pohledu || "");
    var vstupVzdalenost = poleText(
      formular,
      "vzdalenost",
      "Vzdálenost k objektu (m)",
      jeCislo(misto.vzdalenost_k_objektu_m) ? misto.vzdalenost_k_objektu_m : ""
    );
    var vstupVyska = poleText(
      formular,
      "vyska",
      "Výška nad terénem (m)",
      jeCislo(misto.vyska_nad_terenem_m) ? misto.vyska_nad_terenem_m : ""
    );
    var vstupNadmorska = poleText(
      formular,
      "nadmorska",
      "Nadmořská výška (m n. m.)",
      jeCislo(misto.nadmorska_vyska_m) ? misto.nadmorska_vyska_m : ""
    );
    var napovedaVysky = document.createElement("p");
    napovedaVysky.className = "napoveda";
    napovedaVysky.textContent =
      "Stačí vyplnit jednu z výšek — druhá se dopočítá z terénu " + cesky(TEREN_M, 0) + " m n. m.";
    formular.appendChild(napovedaVysky);

    // Fotka: nahrát ze souboru / vybrat z náletu / odkaz — a odebrat.
    // U nového místa potřebujeme id dřív, než se položka založí: nahraná
    // fotka jde do repa pod cestou odvozenou z id.
    var idMista = jeNove ? GH.noveId("cas") : misto.id;
    var stavFotky = { fotka: fotkaMista(misto), blob: null, nahledSrc: "" };
    var blokFotky = vytvorBlokFotky(stavFotky, { idMista: idMista });
    formular.appendChild(blokFotky.prvek);

    var vstupPoznamka = poleText(formular, "poznamka", "Poznámka", misto.poznamka || "", "textarea");

    // ---- bod na mapě ----

    var puvodniBod = misto.bod && Mapa.platnyBod(misto.bod.lat, misto.bod.lon)
      ? { lat: misto.bod.lat, lon: misto.bod.lon }
      : null;
    var vybranyBod = puvodniBod;

    var poleBod = document.createElement("div");
    poleBod.className = "pole";
    var labelBod = document.createElement("label");
    labelBod.textContent = "Poloha (klikni do mapy)";
    poleBod.appendChild(labelBod);

    var kontejnerMapy = document.createElement("div");
    kontejnerMapy.className = "mapa mapa-stredni";
    poleBod.appendChild(kontejnerMapy);

    var textBodu = document.createElement("p");
    textBodu.className = "napoveda";
    textBodu.textContent = vybranyBod
      ? "Souřadnice: " + Mapa.souradnice(vybranyBod.lat, vybranyBod.lon)
      : "Souřadnice zatím nejsou určené.";
    poleBod.appendChild(textBodu);
    formular.appendChild(poleBod);

    var stred = vybranyBod || stredStavby();
    var instanceMapy = Mapa.vytvor(kontejnerMapy, {
      lat: stred.lat,
      lon: stred.lon,
      zoom: Mapa.ZOOM_VYCHOZI,
      klikatelna: true,
      popisek: "Mapa pro určení polohy místa",
      naZmenu: function (bod) {
        vybranyBod = { lat: bod.lat, lon: bod.lon };
        textBodu.textContent = "Souřadnice: " + Mapa.souradnice(bod.lat, bod.lon);
      }
    });
    if (!vybranyBod && instanceMapy) instanceMapy.nastavBod(null, null);

    var chyba = document.createElement("p");
    chyba.className = "formular-chyba";
    chyba.hidden = true;
    formular.appendChild(chyba);

    function zobrazChybu(text) {
      chyba.textContent = text;
      chyba.hidden = false;
    }

    var modal = App.modal({
      nadpis: jeNove ? "Nové místo pro kameru" : "Úprava místa",
      obsah: formular,
      naZavreni: function () {
        if (instanceMapy && typeof instanceMapy.znic === "function") instanceMapy.znic();
      },
      akce: [
        {
          text: "Zrušit",
          druh: "sekundarni",
          fn: function () {
            modal.zavri();
          }
        },
        {
          text: "Uložit",
          druh: "primarni",
          fn: function () {
            uloz();
          }
        }
      ]
    });

    function uloz() {
      var nazev = vstupNazev.value.trim();
      if (!nazev) {
        zobrazChybu("Vyplň název místa.");
        vstupNazev.focus();
        return;
      }
      // Nepotvrzený text v poli odkazu se uplatní (nebo odmítne) tady.
      // Přesnou hlášku i fokus si dá blok Fotka sám, tady jen ukážeme
      // u tlačítka Uložit, proč se nic neuložilo.
      if (!blokFotky.potvrdOdkaz()) {
        zobrazChybu("Oprav odkaz na fotku.");
        return;
      }

      var novaData = {
        nazev: nazev,
        popis: vstupPopis.value.trim(),
        bod: vybranyBod ? { lat: vybranyBod.lat, lon: vybranyBod.lon } : { lat: null, lon: null },
        vyska_nad_terenem_m: cislo(vstupVyska.value),
        nadmorska_vyska_m: cislo(vstupNadmorska.value),
        smer_pohledu: vstupSmer.value.trim(),
        vzdalenost_k_objektu_m: cislo(vstupVzdalenost.value),
        jedna_s: vstupJednaS.value.trim(),
        stav: vyberStav.value,
        kamera: vstupKamera.value.trim(),
        poznamka: vstupPoznamka.value.trim()
      };

      // dopočet druhé výšky z terénu, ať v datech nezůstane díra
      var vysky = dopocitejVysky(novaData.vyska_nad_terenem_m, novaData.nadmorska_vyska_m);
      novaData.vyska_nad_terenem_m = vysky.vyska;
      novaData.nadmorska_vyska_m = vysky.nadmorska;

      // Nejdřív nahrát čekající soubor do repa (v demu se sem nedostaneme),
      // teprve pak zapsat položku — ať v datech neskončí cesta k souboru,
      // který se nenahrál.
      nahrajCekajiciSoubor(stavFotky, idMista)
        .then(function () {
          return zmenCasosber(function (obalka) {
            if (jeNove) {
              var maxPoradi = 0;
              obalka.polozky.forEach(function (p) {
                if (jeCislo(p.poradi) && p.poradi > maxPoradi) maxPoradi = p.poradi;
              });
              var nova = {
                id: idMista,
                poradi: maxPoradi + 1,
                nazev: novaData.nazev,
                popis: novaData.popis,
                foto_id: null,
                foto_url: "",
                foto: prazdnaFotka(),
                bod: novaData.bod,
                vyska_nad_terenem_m: novaData.vyska_nad_terenem_m,
                nadmorska_vyska_m: novaData.nadmorska_vyska_m,
                smer_pohledu: novaData.smer_pohledu,
                vzdalenost_k_objektu_m: novaData.vzdalenost_k_objektu_m,
                jedna_s: novaData.jedna_s,
                stav: novaData.stav,
                kamera: novaData.kamera,
                poznamka: novaData.poznamka,
                smazano: null,
                // přístup / napájení / internet se doplní tlačítkem
                // „Přístup, napájení, internet" na kartě místa
                napajeni: prazdnyBlokStavu(),
                internet: prazdnyBlokStavu(),
                pristup_popis: ""
              };
              zapisFotkuDoPolozky(nova, stavFotky.fotka);
              obalka.polozky.push(nova);
            } else {
              var stavajici = najdiPodleId(obalka.polozky, misto.id);
              if (!stavajici) return;
              Object.keys(novaData).forEach(function (klic) {
                stavajici[klic] = novaData[klic];
              });
              zapisFotkuDoPolozky(stavajici, stavFotky.fotka);
            }
          }, (jeNove ? "Přidáno místo pro časosběrnou kameru: " : "Upraveno místo pro časosběrnou kameru: ") + nazev);
        })
        .then(function (obsah) {
          var veslo = overDemoUlozeni(stavFotky.fotka);
          modal.zavri();
          poUlozeni(obsah, veslo ? (jeNove ? "Místo přidáno." : "Místo uloženo.") : null);
        })
        .catch(function (chybaZapisuMista) {
          chybaZapisu(chybaZapisuMista, "Uložení místa selhalo.");
        });
    }
  }

  // ------------------------------------------------------------------
  // Formulář „Přístup, napájení, internet" (právo casosber.upravit)
  // ------------------------------------------------------------------

  function poleVyber(formular, nazev, popisek, ciselnik, hodnota) {
    var pole = document.createElement("div");
    pole.className = "pole";
    var id = "cas-pole-" + nazev;
    var label = document.createElement("label");
    label.setAttribute("for", id);
    label.textContent = popisek;
    pole.appendChild(label);
    var vyber = document.createElement("select");
    vyber.id = id;
    vyber.name = nazev;
    ciselnik.forEach(function (s) {
      var volba = document.createElement("option");
      volba.value = s.kod;
      volba.textContent = s.nazev;
      if (s.kod === hodnota) volba.selected = true;
      vyber.appendChild(volba);
    });
    pole.appendChild(vyber);
    formular.appendChild(pole);
    return vyber;
  }

  function otevriFormularPripojeni(misto) {
    if (!smiUpravit()) return;

    var napajeni = napajeniMista(misto);
    var internet = internetMista(misto);

    var formular = document.createElement("form");
    formular.className = "formular";

    var uvod = document.createElement("p");
    uvod.className = "napoveda";
    uvod.textContent =
      "Tři věci, které musí být jasné, než se kamera osadí. Hotový dotaz na stavbu " +
      "vyrobí tlačítko „Kopírovat dotaz pro stavbu“ na kartě místa.";
    formular.appendChild(uvod);

    var nadpisPristup = document.createElement("h4");
    nadpisPristup.className = "formular-podsekce";
    nadpisPristup.textContent = "Přístup";
    formular.appendChild(nadpisPristup);

    var vyberPristup = poleVyber(formular, "pripojeni-pristup", "Stav jednání o přístupu", STAVY, misto.stav || "navrzeno");
    var vstupJednaS = poleText(formular, "pripojeni-jedna-s", "S kým se jedná", misto.jedna_s || "");
    var vstupPristupPopis = poleText(
      formular,
      "pripojeni-pristup-popis",
      "Poznámka k přístupu (kdy tam můžeme, přes koho, klíče)",
      pristupPopisMista(misto),
      "textarea"
    );

    var nadpisNapajeni = document.createElement("h4");
    nadpisNapajeni.className = "formular-podsekce";
    nadpisNapajeni.textContent = "Napájení 230 V";
    formular.appendChild(nadpisNapajeni);

    var vyberNapajeni = poleVyber(formular, "pripojeni-napajeni", "Stav napájení", STAVY_NAPAJENI, napajeni.stav);
    var vstupNapajeniPopis = poleText(
      formular,
      "pripojeni-napajeni-popis",
      "Odkud se vezme proud, jaká zásuvka, kdo to zapojí",
      napajeni.popis,
      "textarea"
    );
    var napovedaOdberu = document.createElement("p");
    napovedaOdberu.className = "napoveda";
    napovedaOdberu.textContent = "Kamera má trvalý odběr do " + ODBER_KAMERY_W + " W.";
    formular.appendChild(napovedaOdberu);

    var nadpisInternetu = document.createElement("h4");
    nadpisInternetu.className = "formular-podsekce";
    nadpisInternetu.textContent = "Internet";
    formular.appendChild(nadpisInternetu);

    var vyberInternetu = poleVyber(formular, "pripojeni-internet", "Stav připojení", STAVY_INTERNETU, internet.stav);
    var vstupInternetPopis = poleText(
      formular,
      "pripojeni-internet-popis",
      "Jaká wi-fi, kdo dá heslo, kudy by šel kabel",
      internet.popis,
      "textarea"
    );
    var napovedaInternetu = document.createElement("p");
    napovedaInternetu.className = "napoveda";
    napovedaInternetu.textContent =
      "Bez připojení se data budou stahovat ručně při každé návštěvě.";
    formular.appendChild(napovedaInternetu);

    var modal = App.modal({
      nadpis: "Přístup, napájení a internet — " + (misto.nazev || "místo"),
      obsah: formular,
      akce: [
        {
          text: "Zrušit",
          druh: "sekundarni",
          fn: function () {
            modal.zavri();
          }
        },
        {
          text: "Uložit",
          druh: "primarni",
          fn: function () {
            uloz();
          }
        }
      ]
    });

    function uloz() {
      var novaData = {
        stav: vyberPristup.value,
        jedna_s: vstupJednaS.value.trim(),
        pristup_popis: vstupPristupPopis.value.trim(),
        napajeni: { stav: vyberNapajeni.value, popis: vstupNapajeniPopis.value.trim() },
        internet: { stav: vyberInternetu.value, popis: vstupInternetPopis.value.trim() }
      };

      zmenCasosber(function (obalka) {
        var stavajici = najdiPodleId(obalka.polozky, misto.id);
        if (!stavajici) return;
        Object.keys(novaData).forEach(function (klic) {
          stavajici[klic] = novaData[klic];
        });
      }, "Upraven přístup / napájení / internet u místa: " + (misto.nazev || ""))
        .then(function (obsah) {
          modal.zavri();
          poUlozeni(obsah, "Uloženo.");
        })
        .catch(function (chyba) {
          chybaZapisu(chyba, "Uložení selhalo.");
        });
    }
  }

  function smazMisto(misto) {
    if (!smiUpravit()) return;
    App.potvrd('Přesunout místo „' + (misto.nazev || "bez názvu") + '" do koše?').then(function (ano) {
      if (!ano) return;
      zmenCasosber(function (obalka) {
        var p = najdiPodleId(obalka.polozky, misto.id);
        if (p) p.smazano = { kdy: new Date().toISOString(), kdo: mojeId() };
      }, "Smazáno místo pro časosběrnou kameru: " + (misto.nazev || ""))
        .then(function (obsah) {
          poUlozeni(obsah, "Místo přesunuto do koše.");
        })
        .catch(function (chyba) {
          chybaZapisu(chyba, "Smazání místa selhalo.");
        });
    });
  }

  // ------------------------------------------------------------------
  // Sekce vybraných míst
  // ------------------------------------------------------------------

  function vytvorSekciMist() {
    var blok = document.createElement("section");
    blok.className = "oddil cas-mista";

    var hlava = document.createElement("div");
    hlava.className = "sekce-hlavicka";
    var nadpis = document.createElement("h3");
    nadpis.className = "podnadpis-sekce";
    nadpis.textContent = "Vybraná místa";
    hlava.appendChild(nadpis);

    if (smiUpravit()) {
      var pridat = document.createElement("button");
      pridat.type = "button";
      pridat.className = "btn btn-mala btn-primarni";
      pridat.textContent = "Přidat místo";
      pridat.addEventListener("click", function () {
        otevriFormularMista(null);
      });
      hlava.appendChild(pridat);
    }
    blok.appendChild(hlava);

    var vsechna = mista();
    if (!vsechna.length) {
      var prazdno = document.createElement("div");
      prazdno.className = "prazdny-stav";
      var text = document.createElement("p");
      text.className = "prazdny-stav-text";
      text.textContent = "Zatím není vybráno žádné místo. Vyber ho z galerie snímků níže.";
      prazdno.appendChild(text);
      blok.appendChild(prazdno);
      return blok;
    }

    var seznam = document.createElement("div");
    seznam.className = "cas-seznam-mist";
    vsechna.forEach(function (misto, index) {
      seznam.appendChild(vytvorKartuMista(misto, index + 1));
    });
    blok.appendChild(seznam);

    return blok;
  }

  // ------------------------------------------------------------------
  // Galerie náletu (§A.3)
  // ------------------------------------------------------------------

  // `kodFiltru` je volitelný — mřížka v sekci jede podle modulového
  // `aktivniFiltr`, výběr fotky v modálu si nese svůj vlastní.
  function projdeFiltrem(snimek, kodFiltru) {
    switch (kodFiltru || aktivniFiltr) {
      case "dron":
        return snimek.zarizeni === "dron";
      case "rucni":
        return snimek.zarizeni !== "dron";
      case "popis":
        return !!popisSnimku(snimek.id).trim();
      default:
        return true;
    }
  }

  function vytvorFiltr(aktivni, naZmenu) {
    var pruh = document.createElement("div");
    pruh.className = "galerie-filtr";
    pruh.setAttribute("role", "group");
    pruh.setAttribute("aria-label", "Filtr snímků z náletu");

    FILTRY.forEach(function (filtr) {
      var tlacitko = document.createElement("button");
      tlacitko.type = "button";
      tlacitko.className = "filtr-tlacitko" + (aktivni === filtr.kod ? " filtr-tlacitko-aktivni" : "");
      tlacitko.textContent = filtr.nazev;
      tlacitko.setAttribute("aria-pressed", aktivni === filtr.kod ? "true" : "false");
      tlacitko.addEventListener("click", function () {
        if (aktivni === filtr.kod) return;
        naZmenu(filtr.kod);
      });
      pruh.appendChild(tlacitko);
    });

    return pruh;
  }

  // `naKlik` je volitelný — bez něj dlaždice otevře detail snímku,
  // s ním (výběr fotky pro místo) rozhoduje volající.
  function vytvorDlazdici(snimek, index, kNacteni, naKlik) {
    var vyska = snimek.vyska_nad_terenem_m;
    var maPopis = !!popisSnimku(snimek.id).trim();
    var jeVybrany = !!mistoZeSnimku(snimek.id);

    var dlazdice = document.createElement("button");
    dlazdice.type = "button";
    dlazdice.className = "dlazdice";
    dlazdice.setAttribute(
      "aria-label",
      "Snímek " + popisekSnimku(snimek, index) + ", " + snimek.zarizeni
    );

    var ramecek = document.createElement("span");
    ramecek.className = "dlazdice-obrazek";
    var obrazek = document.createElement("img");
    obrazek.alt = "";
    obrazek.loading = "lazy";
    obrazek.decoding = "async";
    obrazek.hidden = true;
    var stav = document.createElement("span");
    stav.className = "dlazdice-stav";
    stav.textContent = "…";
    ramecek.appendChild(obrazek);
    ramecek.appendChild(stav);
    dlazdice.appendChild(ramecek);

    // Už jednou stažený náhled nasadíme rovnou — po překreslení sekce
    // (změna filtru, uložení místa) ať dlaždice neproblikává na „…".
    if (obrazkyVPameti.has(snimek.nahled)) {
      nactiObrazekDo(snimek.nahled, obrazek, stav);
    } else {
      kNacteni.push({ prvek: ramecek, cesta: snimek.nahled, obrazek: obrazek, stav: stav });
    }

    var info = document.createElement("span");
    info.className = "dlazdice-info";

    var prvniRadek = document.createElement("span");
    prvniRadek.className = "dlazdice-radek";
    prvniRadek.textContent = popisekSnimku(snimek, index);
    info.appendChild(prvniRadek);

    var druhyRadek = document.createElement("span");
    druhyRadek.className = "dlazdice-radek dlazdice-slaby";
    if (!smiVidetVysky()) {
      druhyRadek.textContent = "";
    } else {
      druhyRadek.textContent = jeCislo(vyska) ? cesky(vyska) + " m nad terénem" : "výška neznámá";
    }
    info.appendChild(druhyRadek);

    var stitky = document.createElement("span");
    stitky.className = "dlazdice-stitky";

    var stitekZarizeni = document.createElement("span");
    stitekZarizeni.className = "stitek stitek-zarizeni";
    stitekZarizeni.textContent = snimek.zarizeni;
    stitky.appendChild(stitekZarizeni);

    if (maPopis) {
      var stitekPopis = document.createElement("span");
      stitekPopis.className = "stitek stitek-popis";
      stitekPopis.textContent = "popis";
      stitky.appendChild(stitekPopis);
    }
    if (jeVybrany) {
      var stitekVybrano = document.createElement("span");
      stitekVybrano.className = "stitek stitek-vybrano";
      stitekVybrano.textContent = "vybráno";
      stitky.appendChild(stitekVybrano);
    }

    info.appendChild(stitky);
    dlazdice.appendChild(info);

    dlazdice.addEventListener("click", function () {
      if (typeof naKlik === "function") {
        naKlik(snimek, index);
        return;
      }
      otevriDetailSnimku(snimek.id);
    });

    return dlazdice;
  }

  function vytvorGalerii() {
    var blok = document.createElement("section");
    blok.className = "oddil cas-galerie";

    var hlava = document.createElement("div");
    hlava.className = "sekce-hlavicka";
    var nadpis = document.createElement("h3");
    nadpis.className = "podnadpis-sekce";
    nadpis.textContent = "Galerie náletu";
    hlava.appendChild(nadpis);
    var meta = document.createElement("span");
    meta.className = "karta-meta";
    meta.textContent = SNIMKY.length + " finálních snímků z 26. 8. 2026";
    hlava.appendChild(meta);
    blok.appendChild(hlava);

    blok.appendChild(
      vytvorFiltr(aktivniFiltr, function (kod) {
        // Překreslení sekce srazí stránku nahoru — uživatel je přitom u galerie
        // dole. Zapamatujeme si pozici a vrátíme ji (Franta 30. 8.).
        var pozice = window.scrollY;
        aktivniFiltr = kod;
        App.prekresli();
        window.scrollTo(0, pozice);
      })
    );

    var vyfiltrovane = SNIMKY.map(function (snimek, index) {
      return { snimek: snimek, index: index };
    }).filter(function (zaznam) {
      return projdeFiltrem(zaznam.snimek, aktivniFiltr);
    });

    var pocitadlo = document.createElement("p");
    pocitadlo.className = "karta-meta cas-pocitadlo";
    pocitadlo.textContent = "Zobrazeno " + vyfiltrovane.length + " ze " + SNIMKY.length + " snímků.";
    blok.appendChild(pocitadlo);

    if (!vyfiltrovane.length) {
      var prazdno = document.createElement("div");
      prazdno.className = "prazdny-stav";
      var text = document.createElement("p");
      text.className = "prazdny-stav-text";
      text.textContent = "Tomuto filtru neodpovídá žádný snímek.";
      prazdno.appendChild(text);
      blok.appendChild(prazdno);
      return blok;
    }

    var mrizka = document.createElement("div");
    mrizka.className = "galerie-mrizka";
    var kNacteni = [];
    vyfiltrovane.forEach(function (zaznam) {
      mrizka.appendChild(vytvorDlazdici(zaznam.snimek, zaznam.index, kNacteni));
    });
    blok.appendChild(mrizka);

    // načítání náhledů až ve chvíli, kdy dlaždice doroluje do výřezu (§A.6)
    window.setTimeout(function () {
      zapniPozorovatele(kNacteni);
    }, 0);

    return blok;
  }

  // ------------------------------------------------------------------
  // Detail snímku v modálu (§A.3)
  // ------------------------------------------------------------------

  function otevriDetailSnimku(fotoId) {
    var snimek = snimekPodleId(fotoId);
    if (!snimek) return;
    var index = indexSnimku(fotoId);
    var mapaInstance = null;

    var obsah = document.createElement("div");
    obsah.className = "detail-snimku";

    // ---- velký náhled (načítá se až tady, §A.6) ----

    var obalObrazku = document.createElement("div");
    obalObrazku.className = "detail-obrazek";
    var odkazObrazku = document.createElement("a");
    odkazObrazku.target = "_blank";
    odkazObrazku.rel = "noopener noreferrer";
    odkazObrazku.title = "Otevřít v nové záložce";
    var obrazek = document.createElement("img");
    obrazek.alt = "";
    obrazek.decoding = "async";
    obrazek.hidden = true;
    odkazObrazku.appendChild(obrazek);
    obalObrazku.appendChild(odkazObrazku);
    var stavObrazku = document.createElement("p");
    stavObrazku.className = "cas-foto-stav";
    stavObrazku.textContent = "Načítám velký náhled…";
    obalObrazku.appendChild(stavObrazku);
    obsah.appendChild(obalObrazku);

    if (window.GH && typeof GH.nactiSoubor === "function") {
      GH.nactiSoubor(snimek.velky)
        .then(function (src) {
          if (!src) {
            stavObrazku.textContent = "Velký náhled se nepodařilo načíst.";
            return;
          }
          obrazek.src = src;
          obrazek.hidden = false;
          stavObrazku.hidden = true;
          nastavOdkazNaVelky(odkazObrazku, src);
        })
        .catch(function (chyba) {
          console.warn("Časosběr — velký náhled selhal:", chyba);
          stavObrazku.textContent = "Velký náhled se nepodařilo načíst.";
        });
    } else {
      stavObrazku.textContent = "Velký náhled není k dispozici.";
    }

    // ---- metadata ----

    var meta = document.createElement("p");
    meta.className = "karta-meta";
    meta.textContent =
      "Snímek " + popisekSnimku(snimek, index) + " · " + snimek.zarizeni + " · " + snimek.soubor;
    obsah.appendChild(meta);

    obsah.appendChild(blokVysky(snimek.vyska_nad_terenem_m, snimek.nadmorska_vyska_m));

    if (snimek.odvozeno_z) {
      var odvozeno = document.createElement("p");
      odvozeno.className = "cas-drobne";
      odvozeno.textContent = "poloha odvozena z " + snimek.odvozeno_z;
      obsah.appendChild(odvozeno);
    }

    // ---- popis snímku (§A.4) ----

    var polePopisu = document.createElement("div");
    polePopisu.className = "pole";
    var labelPopisu = document.createElement("label");
    labelPopisu.setAttribute("for", "cas-popis-snimku");
    labelPopisu.textContent = "Popis";
    polePopisu.appendChild(labelPopisu);
    var vstupPopisu = document.createElement("textarea");
    vstupPopisu.id = "cas-popis-snimku";
    vstupPopisu.rows = 3;
    vstupPopisu.value = popisSnimku(fotoId);
    vstupPopisu.placeholder = "Co je na snímku a proč by to bylo dobré místo pro kameru…";
    vstupPopisu.disabled = !smiUpravit();
    polePopisu.appendChild(vstupPopisu);
    obsah.appendChild(polePopisu);

    if (smiUpravit()) {
      var ulozitPopis = document.createElement("button");
      ulozitPopis.type = "button";
      ulozitPopis.className = "btn btn-mala btn-sekundarni";
      ulozitPopis.textContent = "Uložit popis";
      ulozitPopis.addEventListener("click", function () {
        ulozitPopis.disabled = true;
        ulozPopisSnimku(fotoId, vstupPopisu.value.trim())
          .then(function () {
            ulozitPopis.disabled = false;
          })
          .catch(function () {
            ulozitPopis.disabled = false;
          });
      });
      obsah.appendChild(ulozitPopis);
    }

    // ---- mapa s bodem ----

    var nadpisMapy = document.createElement("h4");
    nadpisMapy.className = "detail-podnadpis";
    nadpisMapy.textContent = "Poloha";
    obsah.appendChild(nadpisMapy);

    var maGps = Mapa.platnyBod(snimek.lat, snimek.lon);
    var poloha = polohaSnimku(snimek);

    var textPolohy = document.createElement("p");
    textPolohy.className = "napoveda";
    textPolohy.textContent = poloha
      ? "Souřadnice: " + Mapa.souradnice(poloha.lat, poloha.lon) + (poloha.rucni ? " (určeno klikem do mapy)" : "")
      : "Snímek z ruční kamery nemá GPS — klikni do mapy a urči, odkud je.";
    obsah.appendChild(textPolohy);

    var kontejnerMapy = document.createElement("div");
    kontejnerMapy.className = "mapa mapa-stredni";
    obsah.appendChild(kontejnerMapy);

    var stredMapy = poloha || stredStavby();
    mapaInstance = Mapa.vytvor(kontejnerMapy, {
      lat: stredMapy.lat,
      lon: stredMapy.lon,
      zoom: Mapa.ZOOM_VYCHOZI,
      klikatelna: !maGps,
      popisek: "Mapa snímku #" + (index + 1),
      naZmenu: function (bod) {
        rucniBody.set(fotoId, { lat: bod.lat, lon: bod.lon });
        textPolohy.textContent = "Souřadnice: " + Mapa.souradnice(bod.lat, bod.lon) + " (určeno klikem do mapy)";
        aktualizujTlacitkoVyberu();
      }
    });
    if (!poloha && mapaInstance) mapaInstance.nastavBod(null, null);

    // ---- tlačítko „Vybrat jako místo pro kameru" (§A.3) ----

    var akceVyberu = document.createElement("div");
    akceVyberu.className = "detail-akce";
    var tlacitkoVyberu = document.createElement("button");
    tlacitkoVyberu.type = "button";
    tlacitkoVyberu.className = "btn btn-primarni";
    tlacitkoVyberu.textContent = "Vybrat jako místo pro kameru";
    akceVyberu.appendChild(tlacitkoVyberu);
    var stitekVyberu = document.createElement("span");
    stitekVyberu.className = "stitek stitek-vybrano";
    stitekVyberu.hidden = true;
    akceVyberu.appendChild(stitekVyberu);
    var odkazNaMisto = document.createElement("button");
    odkazNaMisto.type = "button";
    odkazNaMisto.className = "btn btn-mala btn-sekundarni";
    odkazNaMisto.hidden = true;
    akceVyberu.appendChild(odkazNaMisto);
    obsah.appendChild(akceVyberu);

    function aktualizujTlacitkoVyberu() {
      var existujici = mistoZeSnimku(fotoId);
      if (existujici) {
        tlacitkoVyberu.disabled = true;
        stitekVyberu.hidden = false;
        stitekVyberu.textContent = "už je vybráno";
        odkazNaMisto.hidden = false;
        odkazNaMisto.textContent = "Přejít na místo „" + (existujici.nazev || "bez názvu") + '"';
        odkazNaMisto.onclick = function () {
          modal.zavri();
          prejdiNaMisto(existujici.id);
        };
        return;
      }
      stitekVyberu.hidden = true;
      odkazNaMisto.hidden = true;
      if (!smiUpravit()) {
        // Ctenar nema editacni prvky vubec videt (KONTRAKT.md S 5) — misto
        // sedive mrtve neaktivni tlacitko radeji vysvetlujici veta.
        tlacitkoVyberu.hidden = true;
        tlacitkoVyberu.disabled = true;
        if (!tlacitkoVyberu.dataset.vysvetlenoCtenari) {
          tlacitkoVyberu.dataset.vysvetlenoCtenari = "1";
          var vysvetleni = document.createElement("p");
          vysvetleni.className = "karta-meta";
          vysvetleni.textContent = "Místa pro kamery vybírá tým Františka Drona.";
          if (tlacitkoVyberu.parentNode) {
            tlacitkoVyberu.parentNode.insertBefore(vysvetleni, tlacitkoVyberu);
          }
        }
        return;
      }
      tlacitkoVyberu.hidden = false;
      tlacitkoVyberu.disabled = false;
      tlacitkoVyberu.title = "";
    }

    tlacitkoVyberu.addEventListener("click", function () {
      tlacitkoVyberu.disabled = true;
      vyberSnimekJakoMisto(snimek, index, vstupPopisu.value.trim())
        .then(function () {
          modal.zavri();
        })
        .catch(function () {
          tlacitkoVyberu.disabled = false;
        });
    });

    aktualizujTlacitkoVyberu();

    var modal = App.modal({
      nadpis: "Snímek " + popisekSnimku(snimek, index),
      obsah: obsah,
      naZavreni: function () {
        if (mapaInstance && typeof mapaInstance.znic === "function") mapaInstance.znic();
        var kontejnerModalu = document.getElementById("modal-kontejner");
        if (kontejnerModalu) kontejnerModalu.classList.remove("modal-siroky");
      },
      akce: [
        {
          text: "Zavřít",
          druh: "sekundarni",
          fn: function () {
            modal.zavri();
          }
        }
      ]
    });

    // detail snímku je „široký modal" (§A.3) — třída se sundá při zavření
    var kontejnerModaluOtevreny = document.getElementById("modal-kontejner");
    if (kontejnerModaluOtevreny) kontejnerModaluOtevreny.classList.add("modal-siroky");

    return modal;
  }

  // ------------------------------------------------------------------
  // Uložení popisu snímku (§A.4)
  // ------------------------------------------------------------------

  function ulozPopisSnimku(fotoId, text) {
    if (!smiUpravit()) {
      App.toast("Na úpravu popisů potřebuješ právo casosber.upravit.", "chyba");
      return Promise.reject(new Error("bez práva"));
    }
    var zapsanoDoObalky = false;
    return zmenCasosber(function (obalka) {
      // Pojistka: kdyby datová vrstva podala jen pole položek, spadneme
      // do nouzové větve níž (uložení do paměti relace + hláška).
      if (!obalka.popisy) return;
      if (text) {
        obalka.popisy[fotoId] = text;
      } else {
        delete obalka.popisy[fotoId];
      }
      zapsanoDoObalky = true;
    }, "Popis snímku #" + cisloSnimku(fotoId) + " z náletu")
      .then(function (obsah) {
        App.uloz("casosber", obsah);
        if (zapsanoDoObalky) {
          delete popisyVPameti[fotoId];
          App.toast("Popis uložen.", "ok");
        } else {
          // Datová vrstva blok `popisy` nezapsala — držíme popis aspoň
          // v paměti relace a řekneme to nahlas, ať se nikdo nespoléhá.
          popisyVPameti[fotoId] = text;
          if (!popisyJenVPameti) {
            popisyJenVPameti = true;
            App.toast(
              "Popis zatím zůstává jen v tomto prohlížeči — datová vrstva neumí zapsat blok popisů do casosber.json.",
              "info"
            );
          }
        }
        App.prekresli();
        return obsah;
      })
      .catch(function (chyba) {
        chybaZapisu(chyba, "Uložení popisu selhalo.");
        throw chyba;
      });
  }

  // ------------------------------------------------------------------
  // „Vybrat jako místo pro kameru" (§A.3)
  // ------------------------------------------------------------------

  function vyberSnimekJakoMisto(snimek, index, popis) {
    if (!smiUpravit()) {
      App.toast("Na výběr míst potřebuješ právo casosber.upravit.", "chyba");
      return Promise.reject(new Error("bez práva"));
    }
    var poloha = polohaSnimku(snimek);
    var vysky = dopocitejVysky(snimek.vyska_nad_terenem_m, snimek.nadmorska_vyska_m);
    var nazev = "Místo ze snímku #" + (index + 1);

    return zmenCasosber(function (obalka) {
      // pojistka proti dvojkliku / souběhu: když už z toho snímku místo je,
      // druhé nezakládej
      var uzExistuje = obalka.polozky.some(function (p) {
        if (!p || p.smazano) return false;
        var f = fotkaMista(p);
        return f.zdroj === "nalet" && f.foto_id === snimek.id;
      });
      if (uzExistuje) return;

      var maxPoradi = 0;
      obalka.polozky.forEach(function (p) {
        if (jeCislo(p.poradi) && p.poradi > maxPoradi) maxPoradi = p.poradi;
      });

      obalka.polozky.push({
        id: GH.noveId("cas"),
        poradi: maxPoradi + 1,
        nazev: nazev,
        popis: popis || "",
        foto_id: snimek.id,
        foto_url: "",
        foto: { zdroj: "nalet", cesta: "", foto_id: snimek.id },
        bod: poloha ? { lat: poloha.lat, lon: poloha.lon } : { lat: null, lon: null },
        vyska_nad_terenem_m: vysky.vyska,
        nadmorska_vyska_m: vysky.nadmorska,
        smer_pohledu: "",
        vzdalenost_k_objektu_m: null,
        jedna_s: "",
        stav: "navrzeno",
        kamera: "",
        poznamka: "",
        smazano: null,
        // prázdná pole ve správném tvaru — vyplní se, až se doptáme stavby
        napajeni: prazdnyBlokStavu(),
        internet: prazdnyBlokStavu(),
        pristup_popis: ""
      });
    }, "Vybráno místo pro kameru ze snímku #" + (index + 1))
      .then(function (obsah) {
        poUlozeni(obsah, "Místo přidáno — přejmenuj ho podle skutečnosti.");
        return obsah;
      })
      .catch(function (chyba) {
        chybaZapisu(chyba, "Výběr místa selhal.");
        throw chyba;
      });
  }

  // ------------------------------------------------------------------
  // Vykreslení celé sekce
  // ------------------------------------------------------------------

  function vykresli(kontejnerParam) {
    nactiNalet();
    var kontejner = kontejnerParam || document.getElementById("obsah");
    if (!kontejner) return;

    zrusPozorovatele();
    zrusMapy();

    var hlava = document.createElement("div");
    hlava.className = "sekce-hlava";
    var nadpis = document.createElement("h2");
    nadpis.textContent = "Časosběr";
    hlava.appendChild(nadpis);
    kontejner.appendChild(hlava);

    var uvod = document.createElement("p");
    uvod.className = "podnadpis-sekce";
    uvod.textContent =
      "Kam pověsit dvě časosběrné kamery na tři roky. Místa se vybírají ze snímků z náletu 26. 8. 2026, " +
      "přístup k nim pak domlouvá PORR a Emauzský klášter s majiteli.";
    kontejner.appendChild(uvod);

    kontejner.appendChild(vytvorPruhInstalace());
    kontejner.appendChild(vytvorSouhrn());
    kontejner.appendChild(vytvorPrehledovouMapu());
    kontejner.appendChild(vytvorSekciMist());
    kontejner.appendChild(vytvorGalerii());
  }

  App.registrujSekci("casosber", vykresli);
})();
