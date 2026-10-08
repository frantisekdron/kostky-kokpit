/*
 * view-prehled.js — sekce "Přehled" (KONTRAKT.md §9.1, dodatek §B.3).
 *
 * Přestavba z 8. 10. 2026 (Franta: "maximálně efektivní, decentní, moderní
 * a hlavně praktický", podobně jako Návštěvy). Přehled je úvodní obrazovka
 * pro všechny role — náš tým, investora PORR i zhotovitele Metrostav — a
 * stavbaři chtějí jednoduché, takže shora dolů:
 *
 *   1. Projekt      — název, strany, místo a časový pruh "Měsíc X z Y" se
 *                     značkami konce smlouvy a předání (bez rámečku).
 *   2. Pozornost    — jen to, co na někoho čeká (návštěva ke schválení,
 *                     milník po termínu, expirující MyAirBridge, blížící se
 *                     průběžné video, interní upozornění). Když nic, je to
 *                     jeden tichý řádek "Vše v pořádku".
 *   3. Mřížka       — vlevo Příští návštěva (lísteček s datem, odpočet, co se
 *                     natočí, tlačítka + 3 další návštěvy) a Stavba (teď /
 *                     další milník + segmentový ukazatel); vpravo Plnění
 *                     rozsahu (prstenec + řádky) a Poslední aktivita.
 *
 * Datum, lístečky a stavové čipy záměrně sdílejí třídy .nv-* ze sekce
 * Návštěvy, ať jsou obě obrazovky na pohled jedna rodina; vlastní třídy
 * mají prefix ph-. Vzhled je celý v styles.css (blok "PŘEHLED").
 *
 * Skrytí interního upozornění (uloží se do nastaveni.data.upozorneni_skryto)
 * smí jen kdo má právo "nastaveni.upravit". Interní obchodní pozici vůči
 * PORR vidí jen superadmin s odemčeným úložištěm (App.interniObchodni).
 *
 * Čte App.polozky(soubor)/App.obsah(soubor) — App.data drží VŽDY celou
 * obálku souboru, nikdy se nesahá na App.data[soubor] přímo (viz hlavičkový
 * komentář js/app.js). Po zápisu (GH.zmen('nastaveni', ...)) uloží celou
 * vrácenou obálku pomocí App.uloz('nastaveni', obsah).
 *
 * Nevystavuje žádný nový globální objekt — jen se při načtení stránky
 * zaregistruje jako sekce "prehled" přes App.registrujSekci(). Všechna
 * vlastní pomocná jména jsou schovaná uvnitř IIFE.
 */

(function () {
  "use strict";

  var esc = Util.esc;
  var posledniKontejner = null;

  // Rozbalená aktivita se drží v modulu: sekce se pollingem překresluje (každý
  // zápis dat) a po překreslení by se jinak zase sbalila.
  var aktivitaVse = false;

  var AKTIVITA_ZAKLAD = 6;   // kolik záznamů je vidět hned
  var AKTIVITA_MAX = 15;     // kolik jich je vidět po rozbalení (jako dřív)
  var POTOM_POCET = 3;       // kolik dalších návštěv pod kartou Příští
  var VIDEO_VAROVANI_DNI = 45;
  var POZORNOST_MAX_NAVSTEV = 3;  // víc návštěv ke schválení se sloučí do jednoho řádku
  var POZORNOST_MAX_MILNIKU = 2;  // víc milníků po termínu se sloučí do jednoho řádku

  // Stejné názvy jako v sekci Návštěvy, ať čip vypadá všude stejně.
  var STAV_LABEL = {
    navrh: "Návrh",
    "ke-schvaleni": "Čeká na schválení",
    schvaleno: "Schváleno",
    potvrzeno: "Termín potvrzen",
    probehlo: "Proběhlo",
    zruseno: "Zrušeno"
  };

  var TYP_LABEL = {
    foto: "Foto",
    dron: "Dron",
    rucni: "Ruční",
    "casosber-servis": "Časosběr",
    rozhovor: "Rozhovor"
  };
  var TYP_PORADI = ["foto", "dron", "rucni", "casosber-servis", "rozhovor"];

  var MESICE_ZKR = ["led", "úno", "bře", "dub", "kvě", "čvn", "čvc", "srp", "zář", "říj", "lis", "pro"];

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

  function rozlozDatum(iso) {
    var d = String(iso || "").split("-");
    return { rok: parseInt(d[0], 10), mesic: parseInt(d[1], 10), den: parseInt(d[2], 10) };
  }

  function popisekExpirace(dny) {
    if (dny < 0) return "vypršelo";
    return "expiruje " + Util.formatOdpocet(dny);
  }

  function jePorr(m) {
    return (m.prijemce || "PORR") === "PORR";
  }

  function popisOsoby(o) {
    if (!o) return "";
    return o.telefon ? o.jmeno + " (" + o.telefon + ")" : o.jmeno;
  }

  // Datum návštěvy VŽDY přes Util.formatDatum s přesností z položky (chybí-li,
  // bere se "presne"); u přesnosti "obdobi" se předává i datum_do. Stejná
  // funkce je i ve view-navstevy.js — sjednoceno napříč appkou (nález auditu
  // O1-sjednoceni-appdata).
  function formatDatumNavstevy(n) {
    if (!n || !n.datum) return "";
    return Util.formatDatum(n.datum, n.datum_presnost || "presne", n.datum_do || null);
  }

  // Přesné datum? (Návštěva bez data se bere jako orientační — nic nevíme.)
  function jePresne(n) {
    return !!n.datum && (n.datum_presnost || "presne") === "presne";
  }

  // Datum do věty: u orientačního termínu s dovětkem, ať si nikdo nemyslí, že je
  // den pevný.
  function datumTextNavstevy(n) {
    if (!n || !n.datum) return "";
    return formatDatumNavstevy(n) + (jePresne(n) ? "" : " (orientačně)");
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

  // Nález auditu (viz stejná úprava ve view-navstevy.js): prázdné "za_stavbu"
  // se dřív vypisovalo jako holá pomlčka — u potvrzeno/probehlo jde ale o
  // chybějící údaj, proto se tam navíc zvýrazní štítkem. Vrací už bezpečný
  // HTML fragment (jméno je esc()-nuté, zbytek je statický text).
  function htmlZaStavbu(n, lide) {
    var vybrani = n.za_stavbu || [];
    if (vybrani.length) return esc(seznamOsobPodleId(vybrani, lide));
    var text = esc("zatím nikdo — doplní se při potvrzení termínu");
    if (n.stav === "potvrzeno" || n.stav === "probehlo") {
      return text + ' <span class="stitek" style="--stav-barva:var(--chyba)">chybí</span>';
    }
    return text;
  }

  function tvarCisla(pocet, jeden, dva, vic) {
    if (pocet === 1) return jeden;
    if (pocet >= 2 && pocet <= 4) return dva;
    return vic;
  }

  // Kdo smí vidět sekci Plán stavby (a tím i odkazy na ni). Musí zůstat stejné
  // jako PRAVO_SEKCE.plan v js/app.js; je to i okruh, který vidí protiplnění
  // pro Emauzský klášter (náš závazek, stavby se netýká).
  function jeNasTym() {
    return !!(window.Auth && (Auth.role === "superadmin" ||
      (typeof App.jsemZaFD === "function" && App.jsemZaFD())));
  }

  // Hlavička karty: tichý titulek vlevo, volitelný odkaz vpravo.
  function htmlHlavaKarty(nadpis, href, odkazText) {
    return '<div class="ph-karta-hlava"><h3 class="ph-karta-nadpis">' + esc(nadpis) + "</h3>" +
      (href ? '<a class="ph-karta-odkaz" href="' + esc(href) + '">' + esc(odkazText) + " →</a>" : "") +
      "</div>";
  }

  // Navigační tlačítko je odkaz (a ne button), ať jde otevřít i do nového okna
  // a router si hash obslouží sám.
  function htmlOdkazTlacitko(href, text, trida) {
    return '<a class="btn ' + (trida || "btn-sekundarni") + ' btn-mala" href="' + esc(href) + '">' + esc(text) + "</a>";
  }

  // ---- 1. projekt: název + časový pruh (měsíc X z Y, zahájení→předání) ----

  function mesicProjektu(zahajeniIso, predaniIso) {
    var z = rozlozDatum(zahajeniIso);
    var p = rozlozDatum(predaniIso);
    if (!z.rok || !p.rok) return null;

    var celkem = (p.rok - z.rok) * 12 + (p.mesic - z.mesic) + 1;
    var ted = new Date();
    var ubehleMesic = (ted.getFullYear() - z.rok) * 12 + (ted.getMonth() + 1 - z.mesic) + 1;
    ubehleMesic = Math.max(1, Math.min(celkem, ubehleMesic));

    var zacatek = new Date(z.rok, z.mesic - 1, z.den);
    var konec = new Date(p.rok, p.mesic - 1, p.den);
    var dnesStart = new Date(ted.getFullYear(), ted.getMonth(), ted.getDate());
    var procento = 0;
    if (konec > zacatek) {
      procento = ((dnesStart - zacatek) / (konec - zacatek)) * 100;
    }
    procento = Math.max(0, Math.min(100, procento));

    return { ubehleMesic: ubehleMesic, celkem: celkem, procento: procento };
  }

  // Kde na ose zahájení→předání leží dané datum (v %), nebo null. Slouží
  // svislé značce konce smlouvy.
  function procentoNaOse(zahajeniIso, predaniIso, iso) {
    var z = rozlozDatum(zahajeniIso);
    var p = rozlozDatum(predaniIso);
    var x = rozlozDatum(iso);
    if (!z.rok || !p.rok || !x.rok) return null;
    var zacatek = new Date(z.rok, z.mesic - 1, z.den);
    var konec = new Date(p.rok, p.mesic - 1, p.den);
    var bod = new Date(x.rok, x.mesic - 1, x.den);
    if (!(konec > zacatek)) return null;
    return ((bod - zacatek) / (konec - zacatek)) * 100;
  }

  function htmlCasovyPruh(nastaveni, konecSmlouvy) {
    var mesic = mesicProjektu(nastaveni.zahajeni, nastaveni.predani);
    if (!mesic) return "";

    var html = '<div class="ph-cas">';
    html += '<div class="ph-cas-hlava"><span class="ph-cas-mesic">Měsíc <strong>' + mesic.ubehleMesic +
      "</strong> z " + mesic.celkem + "</span></div>";

    // Značky jsou sourozenci dráhy, ne její děti: dráha má overflow:hidden
    // kvůli zaoblení a značky mají přesahovat nad i pod pruh.
    html += '<div class="ph-cas-osa" role="img" aria-label="Měsíc ' + mesic.ubehleMesic + " z " + mesic.celkem + '">';
    html += '<div class="ph-cas-draha"><div class="ph-cas-vypln" style="width:' + mesic.procento.toFixed(1) + '%"></div></div>';
    var poziceSmlouvy = konecSmlouvy ? procentoNaOse(nastaveni.zahajeni, nastaveni.predani, konecSmlouvy) : null;
    if (poziceSmlouvy !== null && poziceSmlouvy > 0 && poziceSmlouvy < 100) {
      html += '<span class="ph-znacka ph-znacka-smlouva" style="left:' + poziceSmlouvy.toFixed(1) + '%"></span>';
    }
    html += '<span class="ph-znacka ph-znacka-predani"></span>';
    html += "</div>";

    var popis = [Util.formatDatum(nastaveni.zahajeni, "presne")];
    if (konecSmlouvy) popis.push("konec smlouvy " + Util.formatDatum(konecSmlouvy));
    popis.push("předání " + Util.formatDatum(nastaveni.predani, "presne"));
    html += '<div class="ph-cas-popis">' + esc(popis.join(" · ")) + "</div>";
    html += "</div>";
    return html;
  }

  function htmlProjekt(nastaveni, konecSmlouvy) {
    var meta = [];
    if (nastaveni.investor) meta.push('<span title="Investor">' + esc(nastaveni.investor) + "</span>");
    if (nastaveni.zhotovitel_stavba) meta.push('<span title="Zhotovitel stavby">' + esc(nastaveni.zhotovitel_stavba) + "</span>");
    if (nastaveni.misto) meta.push('<span title="Místo">' + esc(nastaveni.misto) + "</span>");

    var html = '<header class="ph-projekt"><div class="ph-projekt-info">';
    html += '<h2 class="ph-projekt-nazev">' + esc(nastaveni.nazev || "") + "</h2>";
    if (nastaveni.podnazev) html += '<p class="ph-projekt-pod">' + esc(nastaveni.podnazev) + "</p>";
    if (meta.length) html += '<p class="ph-projekt-meta">' + meta.join(" · ") + "</p>";
    html += "</div>" + htmlCasovyPruh(nastaveni, konecSmlouvy) + "</header>";
    return html;
  }

  // ---- plnění rozsahu: čistý výpočet (HTML se skládá zvlášť) ----

  // Datum posunuté o celé měsíce (konec sjednané doby dokumentace).
  function poMesicich(iso, mesicu) {
    var d = new Date(iso);
    if (isNaN(d.getTime()) || !mesicu) return null;
    var den = d.getDate();
    d.setMonth(d.getMonth() + Number(mesicu));
    if (d.getDate() < den) d.setDate(0); // kratší měsíc — spadnout na jeho konec
    return d.toISOString().slice(0, 10);
  }

  function rozdilMesicu(odIso, doIso) {
    var a = new Date(odIso);
    var b = new Date(doIso);
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
    return Math.round((b - a) / (1000 * 60 * 60 * 24 * 30.44));
  }

  // Výpočet je beze změny proti předchozí verzi (jen vytažený z vykreslování,
  // protože výsledek potřebuje i řádek pozornosti u průběžného videa).
  function spoctiRozsah(nastaveni, navstevy, materialy, casosber) {
    var rozsah = nastaveni.rozsah || {};
    // Konec sjednané doby. Co je naplánované za ním, do rozsahu nepatří —
    // je to práce na dodatek a počítá se zvlášť.
    var konecSmlouvy = poMesicich(nastaveni.zahajeni, rozsah.mesicu);
    function veSmlouve(n) {
      if (!konecSmlouvy || !n.datum) return true;
      return String(n.datum).slice(0, 10) <= konecSmlouvy;
    }

    var zive = navstevy.filter(function (n) { return !n.smazano; });
    var probehle = zive.filter(function (n) { return n.stav === "probehlo" && veSmlouve(n); });

    var foto = probehle.reduce(function (s, n) { return s + ((n.cerpa && n.cerpa.foto) || 0); }, 0);
    // Natáčecí blok = jeden výjezd s kamerou. V nabídce je "dron + ruční
    // záběry" JEDNA položka (8× blok), takže den, kdy se nelétá (interiéry,
    // počasí, zákaz), je pořád jeden z těch osmi bloků. Proto se z dronu
    // a ručních záběrů bere ten větší, ne součet — jinak by jeden výjezd
    // ukrojil z rozsahu dvakrát. Oba druhy záběrů se pak ukazují zvlášť
    // pod pruhem, ale do součtu rozsahu se nepřičítají.
    var dron = probehle.reduce(function (s, n) {
      var c = n.cerpa || {};
      return s + Math.max(Number(c.dron) || 0, Number(c.video) || 0);
    }, 0);
    var dronSam = probehle.reduce(function (s, n) { return s + ((n.cerpa && n.cerpa.dron) || 0); }, 0);
    var rucni = probehle.reduce(function (s, n) { return s + ((n.cerpa && n.cerpa.video) || 0); }, 0);

    var porrMaterialy = materialy.filter(function (m) { return !m.smazano && jePorr(m); });
    var prubezna = porrMaterialy.filter(function (m) {
      return m.nazev.indexOf("Průběžné video") === 0 && (m.stav === "hotovo" || m.stav === "predano");
    }).length;
    var souhrnne = porrMaterialy.filter(function (m) {
      return m.nazev.indexOf("Souhrnné video") === 0 && (m.stav === "hotovo" || m.stav === "predano");
    }).length;

    // Časosběrné kamery jsou součást rozsahu stejně jako focení a videa.
    // Za osazenou se bere místo, u kterého je vyplněný model kamery — místo
    // bez kamery je pořád jen vytipované, i když je schválené.
    var kamery = (casosber || []).filter(function (m) {
      return !m.smazano && m.kamera && String(m.kamera).trim() !== "";
    }).length;

    var polozky = [
      { klic: "foto", popisek: "Foto sezení", hodnota: foto, max: rozsah.foto_sezeni || 0 },
      { klic: "bloky", popisek: "Natáčecí bloky", hodnota: dron, max: rozsah.dron_bloky || 0 },
      { klic: "prubezna", popisek: "Průběžná videa", hodnota: prubezna, max: rozsah.videa_prubezna || 0 },
      { klic: "souhrnne", popisek: "Souhrnné video", hodnota: souhrnne, max: rozsah.video_souhrnne || 0 },
      { klic: "kamery", popisek: "Časosběrné kamery", hodnota: kamery, max: rozsah.kamery || 0 }
    ];

    // Souhrn jedním číslem. Počítá kusy rozsahu, ne peníze ani odpracovaný
    // čas — u tříleté zakázky ukazuje hlavně to, kolik práce je ještě před námi.
    var dodano = 0;
    var celkem = 0;
    polozky.forEach(function (p) {
      dodano += Math.min(p.hodnota, p.max);
      celkem += p.max;
    });
    var procenta = celkem > 0 ? Math.round((dodano / celkem) * 100) : 0;

    // Smlouva je na sjednaný počet měsíců od zahájení. Stavba se ale předává
    // později, takže zbytek dokumentace není v ceně — ať to je v přehledu
    // vidět dřív, než ta doba doběhne.
    var navic = 0;
    var fotoNavic = 0;
    var blokyNavic = 0;
    if (konecSmlouvy) {
      navic = nastaveni.predani ? rozdilMesicu(konecSmlouvy, nastaveni.predani) : 0;
      // Co je naplánované až za koncem smlouvy. Není to splněný ani nesplněný
      // rozsah — je to práce, která zatím nikde není objednaná.
      var zaSmlouvou = zive.filter(function (n) { return !veSmlouve(n); });
      fotoNavic = zaSmlouvou.reduce(function (s, n) { return s + ((n.cerpa && n.cerpa.foto) || 0); }, 0);
      blokyNavic = zaSmlouvou.reduce(function (s, n) {
        var c = n.cerpa || {};
        return s + Math.max(Number(c.dron) || 0, Number(c.video) || 0);
      }, 0);
    }

    return {
      konecSmlouvy: konecSmlouvy,
      polozky: polozky,
      dodano: dodano,
      celkem: celkem,
      procenta: procenta,
      dronSam: dronSam,
      rucni: rucni,
      prubezna: prubezna,
      navic: navic,
      fotoNavic: fotoNavic,
      blokyNavic: blokyNavic
    };
  }

  // ---- 2. pozornost ----

  function radekPozornosti(zavaznost, textHtml, akceHtml, extraTrida) {
    return '<li class="ph-pozor-radek ph-zav-' + zavaznost + (extraTrida ? " " + extraTrida : "") + '">' +
      '<span class="ph-pozor-tecka" aria-hidden="true"></span>' +
      '<div class="ph-pozor-text">' + textHtml + "</div>" +
      (akceHtml ? '<div class="ph-pozor-akce">' + akceHtml + "</div>" : "") +
      "</li>";
  }

  function konecMilniku(m) {
    return String(m.datum_do || m.datum_od || "").slice(0, 10);
  }

  // Milník je po termínu, když jeho konec je před dneškem a není hotový.
  function jeMilnikPoTerminu(m, dnes) {
    var konec = konecMilniku(m);
    return !!konec && konec < dnes && m.stav !== "hotovo";
  }

  function milnikyPoTerminu(plan, dnes) {
    var po = plan.filter(function (m) { return !m.smazano && jeMilnikPoTerminu(m, dnes); });
    po.sort(function (a, b) { return konecMilniku(a).localeCompare(konecMilniku(b)); });
    return po;
  }

  // Datum milníku ukazujeme doslova (Franta na tom trvá: "konec 09/2026",
  // "cca polovina 10/2026"); formátované datum je jen záchrana, když chybí.
  function datumMilniku(m) {
    return m.datum_slovy || Util.formatDatum(m.datum_od);
  }

  // Nejbližší termín průběžného videa (zahájení + videa_po_mesicich[i]), který
  // je dnes nebo později. Videa se odevzdávají popořadě, takže ta, která už
  // v materiálech jsou hotová, se přeskočí.
  function dalsiPrubezneVideo(nastaveni, dodanaPrubezna, dnes) {
    var po = (nastaveni.rozsah && nastaveni.rozsah.videa_po_mesicich) || [];
    var nejblizsi = null;
    for (var i = 0; i < po.length; i++) {
      if (i < dodanaPrubezna) continue;
      var iso = poMesicich(nastaveni.zahajeni, po[i]);
      if (!iso || iso < dnes) continue;
      if (!nejblizsi || iso < nejblizsi.iso) {
        nejblizsi = { poradi: i + 1, z: po.length, iso: iso };
      }
    }
    return nejblizsi;
  }

  function htmlPozornost(ctx) {
    var radky = [];
    var maVarovani = false;
    function pridej(zavaznost, html) {
      if (zavaznost !== "info") maVarovani = true;
      radky.push(html);
    }

    // (a) návštěvy čekající na schválení
    var cekajici = ctx.navstevy.filter(function (n) { return !n.smazano && n.stav === "ke-schvaleni"; });
    cekajici.sort(function (a, b) {
      return String(a.datum || "").localeCompare(String(b.datum || "")) || ((a.cislo || 0) - (b.cislo || 0));
    });
    if (cekajici.length <= POZORNOST_MAX_NAVSTEV) {
      cekajici.forEach(function (n) {
        var datum = datumTextNavstevy(n);
        pridej("varovani", radekPozornosti("varovani",
          "Návštěva <strong>#" + esc(n.cislo) + " " + esc(n.nazev) + "</strong> čeká na schválení" +
            (datum ? ' <span class="ph-pozor-pozn">· ' + esc(datum) + "</span>" : ""),
          htmlOdkazTlacitko("#navstevy/" + encodeURIComponent(n.id), "Otevřít")));
      });
    } else {
      // Po hromadném odeslání návrhu ke schválení by jich byly desítky řádků —
      // jeden souhrn s odkazem na seznam je praktičtější.
      pridej("varovani", radekPozornosti("varovani",
        "<strong>" + cekajici.length + " " + (cekajici.length === 4 ? "návštěvy čekají" : "návštěv čeká") +
          "</strong> na schválení",
        htmlOdkazTlacitko("#navstevy", "Otevřít")));
    }

    // (b) milníky po termínu — potvrzovat je smí jen ten, kdo vidí Plán stavby,
    // ostatním by řádek jen ukazoval úkol, který nemohou splnit.
    if (ctx.vidiPlan) {
      var po = milnikyPoTerminu(ctx.plan, ctx.dnes);
      po.slice(0, POZORNOST_MAX_MILNIKU).forEach(function (m) {
        pridej("varovani", radekPozornosti("varovani",
          "Milník <strong>" + esc(m.nazev) + "</strong> <span class=\"ph-pozor-pozn\">(" + esc(datumMilniku(m)) +
            ")</span> je po termínu — potvrďte stav",
          htmlOdkazTlacitko("#plan", "Plán stavby")));
      });
      if (po.length > POZORNOST_MAX_MILNIKU) {
        var zbyva = po.length - POZORNOST_MAX_MILNIKU;
        var veta = zbyva === 1 ? "Další milník je po termínu"
          : (zbyva <= 4 ? "Další " + zbyva + " milníky jsou po termínu" : "Dalších " + zbyva + " milníků je po termínu");
        pridej("varovani", radekPozornosti("varovani", esc(veta), htmlOdkazTlacitko("#plan", "Plán stavby")));
      }
    }

    // (c) dodatek §B.3 — protiplnění pro Emauzský klášter. Je to náš závazek,
    // stavby se netýká — upozornění vidí jen náš tým.
    var emauzy = ctx.materialy.filter(function (m) { return !m.smazano && m.prijemce === "Emauzy"; });
    var emauzyHotovo = emauzy.filter(function (m) { return m.stav === "hotovo" || m.stav === "predano"; });
    if (ctx.nasTym && emauzyHotovo.length === 0) {
      pridej("info", radekPozornosti("info",
        "Materiál pro Emauzský klášter zatím nebyl dodán — je to protiplnění za kameru na balkoně",
        htmlOdkazTlacitko("#materialy", "Materiály")));
    }

    // (d) expirující MyAirBridge odkazy
    var expirujici = ctx.materialy.filter(function (m) {
      if (m.smazano || !m.myairbridge || !m.myairbridge.expiruje) return false;
      var dny = Util.zaDni(m.myairbridge.expiruje);
      return dny <= 14;
    });
    expirujici.sort(function (a, b) { return a.myairbridge.expiruje.localeCompare(b.myairbridge.expiruje); });
    expirujici.forEach(function (m) {
      var dny = Util.zaDni(m.myairbridge.expiruje);
      var zav = dny < 0 ? "chyba" : "varovani";
      pridej(zav, radekPozornosti(zav,
        "MyAirBridge <strong>„" + esc(m.nazev) + "“</strong> — " + esc(popisekExpirace(dny)),
        htmlOdkazTlacitko("#materialy", "Materiály")));
    });

    // (e) blížící se průběžné video — je to náš termín dodání, stavbě by
    // jen přidal řádek, se kterým nic neudělá (Franta 8. 10. 2026: „ne“).
    var video = ctx.nasTym ? dalsiPrubezneVideo(ctx.nastaveni, ctx.rozsah.prubezna, ctx.dnes) : null;
    if (video) {
      var dniDoVidea = Util.zaDni(video.iso);
      if (dniDoVidea <= VIDEO_VAROVANI_DNI) {
        var zavVideo = dniDoVidea <= 14 ? "varovani" : "info";
        pridej(zavVideo, radekPozornosti(zavVideo,
          "Průběžné video <strong>č. " + video.poradi + " z " + video.z + "</strong> — termín " +
            esc(Util.formatDatum(video.iso)) + ' <span class="ph-pozor-pozn">(' + esc(Util.formatOdpocet(dniDoVidea)) + ")</span>",
          htmlOdkazTlacitko("#materialy", "Materiály")));
      }
    }

    // (f) INTERNÍ obchodní pozice vůči PORR (co nám v rozsahu chybí a že chceme
    // dodatek). Dřív to viselo na App.jsemZaFD(), tedy na STRANĚ — což kromě
    // Honzy propouštělo i Michala Růžičku (os-07, editor za FD). Franta chtěl,
    // aby to viděl jen on. Rozhoduje proto role superadmin A odemčené
    // šifrované úložiště: samotná role je jen organizační, skutečnou hranicí
    // je heslo, které nikdo jiný nezná.
    var interni = typeof App.interniObchodni === "function" ? App.interniObchodni() : null;
    var upoz = interni ? interni.interni : null;
    if (upoz && upoz.text && !ctx.nastaveni.upozorneni_skryto) {
      // Text jde z privátního datového repa (nastaveni.data.interni_upozorneni),
      // ne z veřejného JS — je v něm naše obchodní pozice vůči PORR a veřejný
      // repo je čitelný komukoli (audit 30. 8. 2026).
      var zavrit = ctx.smiSpravovatNastaveni
        ? '<button type="button" class="ph-zavrit" data-prehled-akce="skryt-upozorneni" aria-label="Skrýt upozornění" title="Skrýt upozornění">×</button>'
        : "";
      pridej("info", radekPozornosti("info",
        '<strong class="ph-pozor-nadpis">' + esc(upoz.nadpis || "Interní upozornění") + "</strong>" +
          ' <span class="ph-chip">jen pro nás</span>' +
          '<p class="ph-pozor-popis">' + esc(upoz.text || "") + "</p>",
        zavrit, "ph-pozor-radek-interni"));
    } else if (typeof App.interniZamceno === "function" && App.interniZamceno()
               && !ctx.nastaveni.upozorneni_skryto) {
      // Zamčeno: neukazujeme obsah, jen kde se odemyká. Vidí to jen superadmin
      // (App.interniZamceno() to hlídá), ostatním se nezobrazí vůbec nic.
      pridej("info", radekPozornosti("info",
        "Interní obchodní čísla jsou zamčená — odemkneš je heslem v sekci Náklady na provoz",
        htmlOdkazTlacitko("#naklady", "Náklady")));
    }

    if (!radky.length) {
      return '<p class="ph-pozornost-prazdno" id="prehled-upozorneni"><span class="ph-ok" aria-hidden="true">✓</span> ' +
        "Vše v pořádku — nic nečeká.</p>";
    }

    return '<section class="ph-karta ph-pozornost' + (maVarovani ? "" : " ph-pozornost-klid") +
      '" id="prehled-upozorneni" aria-labelledby="ph-pozornost-nadpis">' +
      '<div class="ph-karta-hlava"><h3 class="ph-karta-nadpis" id="ph-pozornost-nadpis">Potřebuje pozornost ' +
      '<span class="nv-pocet">' + radky.length + "</span></h3></div>" +
      '<ul class="ph-pozor-seznam">' + radky.join("") + "</ul></section>";
  }

  // ---- 3a. příští návštěva ----

  function vyberDalsiNatoceni(navstevy) {
    var dnes = dnesniIso();
    var zive = navstevy.filter(function (n) { return !n.smazano && n.datum && n.datum >= dnes; });

    function vybratZeStavu(stavy) {
      var kandidati = zive.filter(function (n) { return stavy.indexOf(n.stav) !== -1; });
      kandidati.sort(function (a, b) { return a.datum.localeCompare(b.datum); });
      return kandidati.length ? kandidati[0] : null;
    }

    return vybratZeStavu(["schvaleno", "potvrzeno"]) || vybratZeStavu(["ke-schvaleni", "navrh"]);
  }

  // Další nadcházející návštěvy pod kartou Příští — stejná množina stavů jako
  // ve vyberDalsiNatoceni, takže bez příští návštěvy není ani "Potom".
  function vyberPotom(navstevy, dalsi, dnes, pocet) {
    var kandidati = navstevy.filter(function (n) {
      return !n.smazano && n.datum && n.datum >= dnes && (!dalsi || n.id !== dalsi.id) &&
        ["navrh", "ke-schvaleni", "schvaleno", "potvrzeno"].indexOf(n.stav) !== -1;
    });
    kandidati.sort(function (a, b) {
      return a.datum.localeCompare(b.datum) || ((a.cislo || 0) - (b.cislo || 0));
    });
    return kandidati.slice(0, pocet);
  }

  function mesicuDoTerminu(n) {
    var p = /^(\d{4})-(\d{2})/.exec(String(n.datum || ""));
    if (!p) return null;
    var ted = new Date();
    return (parseInt(p[1], 10) * 12 + parseInt(p[2], 10)) - (ted.getFullYear() * 12 + ted.getMonth() + 1);
  }

  // Měsíc v rámečku jako lísteček z kalendáře (stejné markup jako v Návštěvách).
  // Přesné datum = plný rámeček s dnem, orientační termín = čárkovaný jen s měsícem.
  function htmlDlazdice(n, velikost) {
    var p = rozlozDatum(n.datum);
    var titulek = n.datum ? datumTextNavstevy(n) : "datum neurčeno";
    var tr = velikost ? " ph-dlazdice-" + velikost : "";
    if (!p.rok || !p.mesic) {
      return '<span class="nv-dlazdice nv-dlazdice-orientacni' + tr + '" title="' + esc(titulek) + '">' +
        '<span class="nv-dlazdice-mesic">—</span><span class="nv-dlazdice-den">?</span></span>';
    }
    if (!jePresne(n)) {
      return '<span class="nv-dlazdice nv-dlazdice-orientacni' + tr + '" title="' + esc(titulek) + '">' +
        '<span class="nv-dlazdice-mesic">' + esc(MESICE_ZKR[p.mesic - 1]) + "</span></span>";
    }
    return '<span class="nv-dlazdice' + tr + '" title="' + esc(titulek) + '">' +
      '<span class="nv-dlazdice-mesic">' + esc(MESICE_ZKR[p.mesic - 1]) + "</span>" +
      '<span class="nv-dlazdice-den">' + p.den + "</span></span>";
  }

  // Velký odpočet: číslo zvlášť, jednotka zvlášť. U přesného data do měsíce dny,
  // do roku měsíce, dál roky; u orientačního termínu měsíce ("tento měsíc").
  function htmlOdpocet(n) {
    if (!n.datum) return "";
    var cislo;
    var jednotka = "";
    var minulost;
    var popis;
    if (!jePresne(n)) {
      var m = mesicuDoTerminu(n);
      if (m === null) return "";
      minulost = m < 0;
      var absM = Math.abs(m);
      cislo = absM === 0 ? "tento" : String(absM);
      jednotka = absM === 0 ? "měsíc" : tvarCisla(absM, "měsíc", "měsíce", "měsíců") + (minulost ? " zpět" : "");
      popis = "Termín je zatím jen orientační";
    } else {
      var dni = Util.zaDni(n.datum);
      if (typeof dni !== "number" || isNaN(dni)) return "";
      minulost = dni < 0;
      var abs = Math.abs(dni);
      if (abs === 0) {
        cislo = "dnes";
      } else if (abs === 1 && !minulost) {
        cislo = "zítra";
      } else if (abs < 31) {
        cislo = String(abs);
        jednotka = tvarCisla(abs, "den", "dny", "dní");
      } else if (abs < 365) {
        var mesicu = Math.round(abs / 30.44);
        cislo = String(mesicu);
        jednotka = tvarCisla(mesicu, "měsíc", "měsíce", "měsíců");
      } else {
        var roky = Math.round((abs / 365.25) * 10) / 10;
        var cele = roky === Math.round(roky);
        cislo = String(roky).replace(".", ",");
        jednotka = cele ? tvarCisla(roky, "rok", "roky", "let") : "roku";
      }
      if (jednotka && minulost) jednotka += " zpět";
      popis = Util.formatOdpocet(dni);
    }
    return '<div class="ph-odpocet' + (minulost ? " ph-odpocet-minulost" : "") + '" title="' + esc(popis) + '">' +
      '<span class="ph-odpocet-cislo">' + esc(cislo) + "</span>" +
      (jednotka ? '<span class="ph-odpocet-jednotka">' + esc(jednotka) + "</span>" : "") +
      "</div>";
  }

  // Krátké "za 7 dní" / "za 2 měs." do řádku dalších návštěv (a "před …" pro
  // zpožděné).
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

  function textTypu(n) {
    var typy = n.typ || [];
    var nazvy = [];
    TYP_PORADI.forEach(function (t) {
      if (typy.indexOf(t) !== -1) nazvy.push(TYP_LABEL[t] || t);
    });
    return nazvy.join(" · ");
  }

  function htmlPristi(n, potom, lide, nastaveni) {
    var html = '<section class="ph-karta ph-pristi">';
    html += htmlHlavaKarty("Příští návštěva", "#navstevy", "Všechny návštěvy");

    if (!n) {
      html += '<p class="ph-prazdno">Zatím není naplánovaná žádná další návštěva.</p></section>';
      return html;
    }

    var presne = jePresne(n);
    var datumText = "datum neurčeno";
    if (n.datum) {
      // Den v týdnu jen u přesného data — jinak vznikne "středa září 2026".
      datumText = presne
        ? Util.denVTydnu(n.datum) + " " + formatDatumNavstevy(n)
        : formatDatumNavstevy(n) + " (orientačně)";
      if (n.cas_od && n.cas_do) datumText += ", " + n.cas_od + "–" + n.cas_do;
    }

    html += '<div class="ph-pristi-radek nv-stav-' + esc(n.stav) + '">';
    html += htmlDlazdice(n, "velka");
    html += '<div class="ph-pristi-info">';
    html += '<div class="ph-pristi-nazev"><span class="nv-cislo">#' + esc(n.cislo) + "</span>" + esc(n.nazev) + "</div>";
    html += '<div class="ph-pristi-datum">' + esc(datumText) + "</div>";
    html += '<div class="ph-pristi-meta"><span class="nv-stav nv-stav-' + esc(n.stav) + '">' +
      esc(STAV_LABEL[n.stav] || n.stav) + "</span>";
    var typy = textTypu(n);
    if (typy) html += '<span class="ph-pristi-typy">' + esc(typy) + "</span>";
    html += "</div></div>";
    html += htmlOdpocet(n);
    html += "</div>";

    // Co se natočí — jen první tři, zbytek je v detailu návštěvy.
    var body = n.co_se_toci || [];
    if (body.length) {
      html += '<div class="ph-pristi-blok"><div class="ph-mini-nadpis">Co se natočí</div><ul class="ph-toci">';
      body.slice(0, 3).forEach(function (p) {
        html += "<li" + (p.hotovo ? ' class="ph-hotovo"' : "") + ">" + esc(p.text) + "</li>";
      });
      if (body.length > 3) html += '<li class="ph-toci-dalsi">a další ' + (body.length - 3) + "</li>";
      html += "</ul></div>";
    }

    // Slunce jen u přesného data a se známou polohou — u "října 2026" by
    // východ slunce nic neříkal.
    var slunce = null;
    try {
      if (presne && nastaveni.gps && typeof nastaveni.gps.lat === "number" && typeof nastaveni.gps.lon === "number") {
        slunce = Util.slunce(n.datum, nastaveni.gps.lat, nastaveni.gps.lon);
      }
    } catch (e) { slunce = null; }
    if (slunce) {
      html += '<p class="ph-pristi-drobne"><span aria-hidden="true">☀</span> východ ' + esc(slunce.vychod) +
        " · západ " + esc(slunce.zapad) + " · zlatá hodina " + esc(slunce.zlataOd) + "–" + esc(slunce.zlataDo) + "</p>";
    }

    html += '<div class="ph-pristi-lide"><p class="ph-pristi-drobne">Za stavbu: ' + htmlZaStavbu(n, lide) + "</p>";
    html += '<p class="ph-pristi-drobne">Za nás: ' + esc(seznamOsobPodleId(n.za_nas, lide)) + "</p></div>";

    html += '<div class="ph-pristi-akce">';
    html += htmlOdkazTlacitko("#navstevy/" + encodeURIComponent(n.id), "Otevřít", "btn-primarni");
    html += '<button type="button" class="btn btn-sekundarni btn-mala" data-prehled-akce="svolavka" data-id="' + esc(n.id) + '">Kopírovat svolávku</button>';
    html += '<button type="button" class="btn btn-sekundarni btn-mala" data-prehled-akce="ics" data-id="' + esc(n.id) + '">Do kalendáře</button>';
    html += "</div>";

    if (potom.length) {
      html += '<div class="ph-potom"><div class="ph-mini-nadpis">Potom</div><ul class="ph-potom-seznam">';
      potom.forEach(function (d) {
        var za = textZa(d);
        html += '<li><a class="ph-potom-radek nv-stav-' + esc(d.stav) + '" href="#navstevy/' + encodeURIComponent(d.id) + '">' +
          htmlDlazdice(d, "mala") +
          '<span class="ph-potom-nazev"><span class="nv-cislo">#' + esc(d.cislo) + "</span>" + esc(d.nazev) + "</span>" +
          (za ? '<span class="nv-za">' + esc(za) + "</span>" : "") +
          "</a></li>";
      });
      html += "</ul></div>";
    }

    html += "</section>";
    return html;
  }

  // ---- 3b. stavba (milníky) ----

  function textZaDni(dni) {
    if (dni <= 0) return "";
    if (dni === 1) return "zítra";
    if (dni < 31) return "za " + dni + " " + tvarCisla(dni, "den", "dny", "dní");
    var mesicu = Math.max(1, Math.round(dni / 30.44));
    if (mesicu < 12) return "za " + mesicu + " měs.";
    var roku = Math.max(1, Math.round(dni / 365.25));
    return "za " + roku + " " + tvarCisla(roku, "rok", "roky", "let");
  }

  function htmlRadekMilniku(stitek, m, zaText, popiskaStavu) {
    var html = '<div class="ph-stavba-radek"><span class="ph-stavba-stitek">' + esc(stitek) + "</span>";
    html += '<div class="ph-stavba-telo"><div class="ph-stavba-nazev">' + esc(m.nazev) + "</div>";
    html += '<div class="ph-stavba-detail"><span>' + esc(datumMilniku(m)) + "</span>";
    if (popiskaStavu) {
      html += '<span class="ph-mil-stav ph-mil-stav-' + esc(m.stav) + '">' + esc(popiskaStavu) + "</span>";
    }
    html += "</div></div>";
    if (zaText) html += '<span class="ph-stavba-za">' + esc(zaText) + "</span>";
    html += "</div>";
    return html;
  }

  function htmlStavba(plan, dnes, vidiPlan) {
    var html = '<section class="ph-karta ph-stavba">';
    html += htmlHlavaKarty("Stavba", vidiPlan ? "#plan" : "", "Plán stavby");

    var zive = plan.filter(function (m) { return !m.smazano; });
    zive.sort(function (a, b) {
      return String(a.datum_od || "").localeCompare(String(b.datum_od || "")) || ((a.poradi || 0) - (b.poradi || 0));
    });
    if (!zive.length) {
      html += '<p class="ph-prazdno">Plán stavby zatím nemá žádné milníky.</p></section>';
      return html;
    }

    // "Teď" = probíhající milník; když žádný neběží, poslední hotový.
    var ted = null;
    var tedProbiha = false;
    var i;
    for (i = 0; i < zive.length; i++) {
      if (zive[i].stav === "probiha") { ted = zive[i]; tedProbiha = true; break; }
    }
    if (!ted) {
      for (i = zive.length - 1; i >= 0; i--) {
        if (zive[i].stav === "hotovo") { ted = zive[i]; break; }
      }
    }

    // "Další" = první budoucí nehotový. Co je po termínu a nehotové, se tady
    // nepočítá — to je v řádku pozornosti a oranžově v ukazateli.
    var dalsi = null;
    for (i = 0; i < zive.length; i++) {
      var m = zive[i];
      if (m === ted || m.stav === "hotovo" || m.stav === "probiha") continue;
      if (konecMilniku(m) >= dnes) { dalsi = m; break; }
    }

    if (ted) html += htmlRadekMilniku("Teď", ted, "", tedProbiha ? "probíhá" : "hotovo ✓");
    if (dalsi) {
      var dniDo = dalsi.datum_od ? Util.zaDni(dalsi.datum_od) : NaN;
      var za = isNaN(dniDo) ? "" : (dniDo > 0 ? textZaDni(dniDo) : "termín už běží");
      html += htmlRadekMilniku("Další", dalsi, za, "");
    }

    // Segmentový ukazatel: jeden díl na milník.
    var hotovo = 0;
    var poTerminu = 0;
    var seg = "";
    zive.forEach(function (mil) {
      var trida = "";
      if (mil.stav === "hotovo") {
        hotovo++;
        trida = " ph-seg-hotovo";
      } else if (jeMilnikPoTerminu(mil, dnes)) {
        poTerminu++;
        trida = " ph-seg-po";
      } else if (mil.stav === "probiha") {
        trida = " ph-seg-probiha";
      }
      seg += '<span class="ph-seg-dil' + trida + '" title="' + esc(mil.nazev + " — " + datumMilniku(mil)) + '"></span>';
    });
    var popis = "Hotovo " + hotovo + " z " + zive.length + " milníků";
    html += '<div class="ph-seg" role="img" aria-label="' + esc(popis + (poTerminu ? ", " + poTerminu + " po termínu" : "")) + '">' + seg + "</div>";
    html += '<p class="ph-seg-popis"><span>' + esc(popis) + "</span>";
    if (poTerminu) html += '<span class="ph-po-terminu">' + poTerminu + " po termínu</span>";
    html += "</p></section>";
    return html;
  }

  // ---- 3c. plnění rozsahu ----

  function htmlRadekRozsahu(p, dronSam, rucni) {
    var plno = p.max > 0 && p.hodnota >= p.max;
    var proc = p.max > 0 ? Math.min(100, (p.hodnota / p.max) * 100) : 0;
    var html = '<div class="ph-rozsah-radek' + (plno ? " ph-rozsah-splneno" : "") + '">';
    html += '<span class="ph-rozsah-popisek">' + esc(p.popisek);
    // Pod natáčecími bloky ještě rozpad na dron a ruční záběry. Je to pohled
    // dovnitř téže položky, do součtu rozsahu nevstupuje.
    if (p.klic === "bloky" && (dronSam > 0 || rucni > 0)) {
      html += '<small class="ph-rozsah-pod">dron ' + dronSam + " · ruční " + rucni + "</small>";
    }
    html += "</span>";
    html += '<span class="ph-pruh"><span class="ph-pruh-vypln" style="width:' + proc.toFixed(1) + '%"></span></span>';
    html += '<span class="ph-rozsah-cislo">' + (plno ? '<span class="ph-rozsah-ok" aria-hidden="true">✓</span> ' : "") +
      p.hodnota + "/" + p.max + "</span>";
    html += "</div>";
    return html;
  }

  function htmlRozsah(nastaveni, r) {
    var rozsah = nastaveni.rozsah || {};
    var html = '<section class="ph-karta ph-rozsah">' + htmlHlavaKarty("Plnění rozsahu", "", "");

    html += '<div class="ph-rozsah-hlava">';
    html += '<div class="ph-prstenec" style="--ph-proc:' + r.procenta + '" role="img" aria-label="Plnění rozsahu ' + r.procenta + ' %">' +
      "<span>" + r.procenta + " %</span></div>";
    html += '<div class="ph-rozsah-souhrn"><strong>Dodáno ' + r.dodano + " z " + r.celkem + " položek</strong>";
    if (r.konecSmlouvy) {
      // Smlouva je na sjednaný počet měsíců, stavba se předává později. Upravená
      // objednávka z 10. 9. 2026 prodloužení obsahuje — řeší se dodatkem, není
      // to otevřená otázka.
      var veta = "Smlouva do " + Util.formatDatum(r.konecSmlouvy);
      if (rozsah.termin_objednavky) veta += " (objednávka do " + Util.formatDatum(rozsah.termin_objednavky) + ")";
      if (nastaveni.predani) veta += " · předání " + Util.formatDatum(nastaveni.predani);
      if (r.navic > 0) veta += " (≈ " + r.navic + " měs. navíc dodatkem)";
      html += '<span class="ph-rozsah-smlouva">' + esc(veta) + "</span>";
    }
    html += "</div></div>";

    r.polozky.forEach(function (p) {
      html += htmlRadekRozsahu(p, r.dronSam, r.rucni);
    });

    // Co je naplánované až za koncem smlouvy. Není to splněný ani nesplněný
    // rozsah — je to práce, která zatím nikde není objednaná.
    if (r.fotoNavic > 0 || r.blokyNavic > 0) {
      html += '<p class="ph-rozsah-navic">' +
        esc("Nad rámec smlouvy je zatím v plánu focení " + r.fotoNavic + "× a natáčecí bloky " +
          r.blokyNavic + "×. Patří do dodatku, do pruhů se nepočítají.") + "</p>";
    }
    html += "</section>";
    return html;
  }

  // ---- 3d. poslední aktivita ----

  function popisEntity(a, navstevy, plan, materialy, lide) {
    if (a.entita === "navsteva") {
      var n = a.entita_id ? najdiPodleId(navstevy, a.entita_id) : null;
      return n ? "Návštěva č. " + n.cislo + " — " + n.nazev : "Návštěva";
    }
    if (a.entita === "milnik") {
      var m = a.entita_id ? najdiPodleId(plan, a.entita_id) : null;
      return m ? "Milník — " + m.nazev : "Milník stavby";
    }
    if (a.entita === "material") {
      var mat = a.entita_id ? najdiPodleId(materialy, a.entita_id) : null;
      return mat ? "Materiál — " + mat.nazev : "Materiál";
    }
    if (a.entita === "osoba") {
      var o = a.entita_id ? najdiPodleId(lide, a.entita_id) : null;
      return o ? "Osoba — " + o.jmeno : "Osoba";
    }
    return "Projekt";
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

  // Iniciály do kolečka: první písmeno jména a příjmení, u jednoho slova dvě.
  function inicialy(jmeno) {
    var casti = String(jmeno || "").trim().split(/\s+/).filter(function (c) { return c; });
    if (!casti.length) return "?";
    if (casti.length === 1) return casti[0].slice(0, 2).toUpperCase();
    return (casti[0].charAt(0) + casti[casti.length - 1].charAt(0)).toUpperCase();
  }

  // "před 5 min" / "před 2 h" / "včera", starší záznam jako datum bez času
  // (přesný čas je v tooltipu).
  function relativniCas(iso) {
    var dt = new Date(iso);
    if (isNaN(dt.getTime())) return "—";
    var ted = new Date();
    var minut = Math.round((ted.getTime() - dt.getTime()) / 60000);
    if (minut < 1) return "právě teď"; // i posun hodin do budoucnosti
    if (minut < 60) return "před " + minut + " min";
    if (minut < 24 * 60) return "před " + Math.floor(minut / 60) + " h";
    var dnesStart = new Date(ted.getFullYear(), ted.getMonth(), ted.getDate());
    var denStart = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    if (Math.round((dnesStart - denStart) / 86400000) === 1) return "včera";
    var text = Util.formatCas(iso).replace(/\s+\d{1,2}:\d{2}$/, "");
    if (dt.getFullYear() !== ted.getFullYear()) text += " " + dt.getFullYear();
    return text;
  }

  var IKONA_KOMENTAR = '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M1.5 2.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5.5L3 10.5V8.5h-.5a1 1 0 0 1-1-1z"/></svg>';
  var IKONA_ZMENA = '<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M7.8 2.2l2 2L4 10H2V8z"/></svg>';

  function htmlAktivita(aktivita, navstevy, plan, materialy, lide) {
    var vsechny = aktivita
      .filter(function (a) { return !a.smazano; })
      .slice()
      .sort(function (a, b) { return String(b.kdy).localeCompare(String(a.kdy)); })
      .slice(0, AKTIVITA_MAX);

    var html = '<section class="ph-karta ph-aktivita">' + htmlHlavaKarty("Poslední aktivita", "", "");
    if (!vsechny.length) {
      html += '<p class="ph-prazdno">Zatím žádná aktivita.</p></section>';
      return html;
    }

    var viditelne = aktivitaVse ? vsechny : vsechny.slice(0, AKTIVITA_ZAKLAD);
    html += '<ul class="ph-akt-seznam">';
    viditelne.forEach(function (a) {
      var kdo = jmenoAutora(a.kdo, lide);
      var komentar = a.druh === "komentar";
      var druh = komentar ? "Komentář" : "Změna";
      html += '<li class="ph-akt-radek">' +
        '<span class="ph-avatar" aria-hidden="true">' + esc(inicialy(kdo)) + "</span>" +
        '<div class="ph-akt-telo">' +
        '<div class="ph-akt-meta"><span class="ph-akt-druh ' + (komentar ? "ph-akt-komentar" : "ph-akt-zmena") +
        '" role="img" title="' + esc(druh) + '" aria-label="' + esc(druh) + '">' + (komentar ? IKONA_KOMENTAR : IKONA_ZMENA) + "</span>" +
        "<strong>" + esc(kdo) + "</strong> · " + esc(popisEntity(a, navstevy, plan, materialy, lide)) + "</div>" +
        '<div class="ph-akt-text" title="' + esc(a.text || "") + '">' + esc(a.text || "") + "</div></div>" +
        '<time class="ph-akt-cas" datetime="' + esc(a.kdy) + '" title="' + esc(Util.formatCas(a.kdy)) + '">' +
        esc(relativniCas(a.kdy)) + "</time></li>";
    });
    html += "</ul>";

    if (vsechny.length > AKTIVITA_ZAKLAD) {
      html += '<button type="button" class="btn btn-tiche btn-mala ph-akt-vic" data-prehled-akce="aktivita-vice" aria-expanded="' +
        (aktivitaVse ? "true" : "false") + '">' +
        (aktivitaVse ? "Méně" : "Zobrazit dalších " + (vsechny.length - AKTIVITA_ZAKLAD)) + "</button>";
    }
    html += "</section>";
    return html;
  }

  // ---- vykreslení ----

  function vykresli(kontejner) {
    var cil = kontejner || document.getElementById("obsah");
    if (!cil) return;
    cil.dataset.aktivniSekce = "prehled";
    posledniKontejner = cil;

    var nastaveni = objektZeSouboru("nastaveni");
    var navstevy = polozkyZeSouboru("navstevy");
    var materialy = polozkyZeSouboru("materialy");
    var lide = polozkyZeSouboru("lide");
    var plan = polozkyZeSouboru("plan");
    var aktivita = polozkyZeSouboru("aktivita");
    var casosber = polozkyZeSouboru("casosber");

    var dnes = dnesniIso();
    var nasTym = jeNasTym();
    var smiSpravovatNastaveni = !!(window.Auth && Auth.can && Auth.can("nastaveni.upravit"));
    var dalsi = vyberDalsiNatoceni(navstevy.filter(function (n) { return !n.smazano; }));
    var potom = vyberPotom(navstevy, dalsi, dnes, POTOM_POCET);
    var rozsah = spoctiRozsah(nastaveni, navstevy, materialy, casosber);

    var html = '<div class="nv ph">';
    html += '<div id="prehled-chyba" class="chyba-hlaska" hidden></div>';
    html += htmlProjekt(nastaveni, rozsah.konecSmlouvy);
    html += htmlPozornost({
      nastaveni: nastaveni,
      navstevy: navstevy,
      plan: plan,
      materialy: materialy,
      rozsah: rozsah,
      dnes: dnes,
      nasTym: nasTym,
      vidiPlan: nasTym,
      smiSpravovatNastaveni: smiSpravovatNastaveni
    });
    html += '<div class="ph-mrizka">';
    html += '<div class="ph-kolona">' + htmlPristi(dalsi, potom, lide, nastaveni) + htmlStavba(plan, dnes, nasTym) + "</div>";
    html += '<div class="ph-kolona">' + htmlRozsah(nastaveni, rozsah) + htmlAktivita(aktivita, navstevy, plan, materialy, lide) + "</div>";
    html += "</div></div>";

    cil.innerHTML = html;
    napojPosluchace(cil);

    // Na mobilu je menu dole jako lišta a lístečky se do ní nevejdou — tady
    // jsou proto hned nahoře v Přehledu, ať je každý vidí bez proklikávání.
    var mobil = window.matchMedia && window.matchMedia("(max-width: 719px)").matches;
    if (mobil && window.Listecky && typeof Listecky.vlozDo === "function") {
      var listecky = document.createElement("section");
      listecky.className = "oddil listecky-v-prehledu";
      Listecky.vlozDo(listecky);
      var chyba = cil.querySelector("#prehled-chyba");
      if (chyba && chyba.parentNode) {
        chyba.parentNode.insertBefore(listecky, chyba.nextSibling);
      } else {
        cil.insertBefore(listecky, cil.firstChild);
      }
    }
  }

  // ---- akce ----

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

  function ukazChybu(text) {
    if (!posledniKontejner) return;
    var el = posledniKontejner.querySelector("#prehled-chyba");
    if (!el) return;
    el.hidden = false;
    el.textContent = text;
    setTimeout(function () { el.hidden = true; }, 7000);
  }

  function kopirovatSvolavku(id) {
    var navsteva = najdiPodleId(polozkyZeSouboru("navstevy"), id);
    if (!navsteva) return;
    var text = Util.svolavka(navsteva, {
      lide: polozkyZeSouboru("lide"),
      plan: polozkyZeSouboru("plan"),
      nastaveni: objektZeSouboru("nastaveni")
    });
    Util.doSchranky(text).then(function (ok) {
      toastBezpecne(ok ? "Svolávka zkopírována do schránky." : "Kopírování se nepovedlo.", ok ? "ok" : "chyba");
    });
  }

  function stahnoutIcs(id) {
    var navsteva = najdiPodleId(polozkyZeSouboru("navstevy"), id);
    if (!navsteva) return;
    var obsah = Util.ics(navsteva, { nastaveni: objektZeSouboru("nastaveni") });
    Util.stahni("natoceni-c" + navsteva.cislo + ".ics", obsah, "text/calendar;charset=utf-8");
  }

  function skrytUpozorneni() {
    GH.zmen("nastaveni", function (data) {
      data.upozorneni_skryto = true;
    }, "Skryto upozornění na rozsah smlouvy")
      .then(function (obsah) {
        if (window.App && typeof App.uloz === "function") App.uloz("nastaveni", obsah);
        vykresli(posledniKontejner);
      })
      .catch(function (e) {
        ukazChybu((e && (e.hlaska || e.message)) || "Uložení se nepovedlo.");
      });
  }

  // Rozbalí/sbalí aktivitu. Překreslením se tlačítko vymění, proto se na něj
  // vrací fokus — jinak by klávesnice po stisku skočila na začátek stránky.
  function prepniAktivitu() {
    aktivitaVse = !aktivitaVse;
    vykresli(posledniKontejner);
    var tlacitko = posledniKontejner && posledniKontejner.querySelector('[data-prehled-akce="aktivita-vice"]');
    if (tlacitko) {
      try { tlacitko.focus({ preventScroll: true }); }
      catch (e) { tlacitko.focus(); }
    }
  }

  function napojPosluchace(cil) {
    if (cil._prehledNapojeno) return;
    cil._prehledNapojeno = true;
    cil.addEventListener("click", function (e) {
      if (cil.dataset.aktivniSekce !== "prehled") return;
      var btn = e.target.closest("[data-prehled-akce]");
      if (!btn) return;
      var akce = btn.dataset.prehledAkce;
      if (akce === "svolavka") kopirovatSvolavku(btn.dataset.id);
      else if (akce === "ics") stahnoutIcs(btn.dataset.id);
      else if (akce === "skryt-upozorneni") skrytUpozorneni();
      else if (akce === "aktivita-vice") prepniAktivitu();
    });
  }

  // ---- registrace sekce (viz vysvětlení v view-lide.js) ----

  document.addEventListener("DOMContentLoaded", function () {
    if (window.App && typeof App.registrujSekci === "function") {
      App.registrujSekci("prehled", vykresli);
    }
  });
})();
