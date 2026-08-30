/*
 * view-prehled.js — sekce "Přehled" (KONTRAKT.md §9.1, dodatek §B.3).
 *
 * Souhrnná úvodní obrazovka kokpitu: hlavička projektu s "měsíc X z Y" a
 * progress barem od zahájení do předání, karta nejbližšího natáčení s
 * odpočtem a tlačítky (kopírovat svolávku / do kalendáře), blok upozornění
 * (natvrdo zadrátovaná karta §4.6 o rozsahu smlouvy vs. harmonogramu +
 * protiplnění pro Emauzský klášter dle dodatku §B.3 + expirující MyAirBridge
 * odkazy + počet návštěv čekajících na schválení), plnění rozsahu smlouvy
 * (4 pruhy: foto sezení, dron bloky, průběžná videa, souhrnné video) a
 * posledních 15 záznamů aktivity.
 *
 * Skrytí karty §4.6 (uloží se do nastaveni.data.upozorneni_skryto) smí jen
 * kdo má právo "nastaveni.upravit".
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

  var STAV_LABEL = {
    navrh: "Návrh",
    "ke-schvaleni": "Čeká na schválení",
    schvaleno: "Schváleno",
    potvrzeno: "Potvrzeno",
    probehlo: "Proběhlo",
    zruseno: "Zrušeno"
  };

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

  // ---- hlavička projektu + progress bar (měsíc X z Y, zahájení→předání) ----

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

  function htmlHlavicka(nastaveni) {
    var mesic = mesicProjektu(nastaveni.zahajeni, nastaveni.predani);

    var html = '<section class="oddil karta">';
    html += '<h1 class="karta-nadpis" style="font-size:1.3rem">' + esc(nastaveni.nazev || "") + "</h1>";
    if (nastaveni.podnazev) {
      html += '<p class="podnadpis-sekce" style="margin-top:2px">' + esc(nastaveni.podnazev) + "</p>";
    }
    html += '<dl class="karta-meta" style="display:grid;grid-template-columns:1fr;gap:4px;margin-top:10px">';
    html += "<div><strong>Investor:</strong> " + esc(nastaveni.investor || "—") + "</div>";
    html += "<div><strong>Zhotovitel stavby:</strong> " + esc(nastaveni.zhotovitel_stavba || "—") + "</div>";
    html += "<div><strong>Místo:</strong> " + esc(nastaveni.misto || "—") + "</div>";
    html += "</dl>";

    if (mesic) {
      html += '<div class="progress-radek" style="margin-top:14px">';
      html += '<div class="progress-popisek"><span>Měsíc ' + mesic.ubehleMesic + " z " + mesic.celkem + "</span><span>" +
        esc(Util.formatDatum(nastaveni.zahajeni, "presne")) + " – " + esc(Util.formatDatum(nastaveni.predani, "presne")) + "</span></div>";
      html += '<div class="progress"><div class="progress-vyplneno' + (mesic.procento >= 100 ? " progress-plno" : "") +
        '" style="width:' + mesic.procento.toFixed(1) + '%"></div></div>';
      html += "</div>";
    }
    html += "</section>";
    return html;
  }

  // ---- karta "Další natáčení" ----

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

  function htmlDalsiNatoceni(n, lide, plan, nastaveni) {
    var html = '<section class="oddil karta stav-' + esc(n ? n.stav : "planovano") + '">';
    html += '<div class="karta-hlavicka"><h2 class="karta-nadpis">Další natáčení</h2>';
    if (n) html += '<span class="stitek stav-' + esc(n.stav) + '">' + esc(STAV_LABEL[n.stav] || n.stav) + "</span>";
    html += "</div>";

    if (!n) {
      html += '<p class="karta-popis">Není naplánované žádné natáčení.</p></section>';
      return html;
    }

    var dny = Util.zaDni(n.datum);
    var milnik = n.milnik_id ? najdiPodleId(plan, n.milnik_id) : null;
    var slunce = null;
    try {
      if (nastaveni.gps && typeof nastaveni.gps.lat === "number" && typeof nastaveni.gps.lon === "number") {
        slunce = Util.slunce(n.datum, nastaveni.gps.lat, nastaveni.gps.lon);
      }
    } catch (e) { slunce = null; }

    html += '<p class="karta-popis"><strong>Návštěva č. ' + n.cislo + " — " + esc(n.nazev) + "</strong></p>";
    // Den v tydnu jen u presneho data — jinak vznikne "streda zari 2026".
    var presnostN = n.datum_presnost || "presne";
    html += '<p class="karta-meta">';
    if (presnostN === "presne") html += esc(Util.denVTydnu(n.datum)) + " ";
    html += esc(formatDatumNavstevy(n));
    if (presnostN !== "presne") html += " (orientačně)";
    if (n.cas_od && n.cas_do) html += ", " + esc(n.cas_od) + "–" + esc(n.cas_do);
    html += " · " + esc(Util.formatOdpocet(dny)) + "</p>";
    if (slunce) {
      html += '<p class="karta-meta">☀ ' + esc(slunce.vychod) + " · 🌇 " + esc(slunce.zapad) +
        " · zlatá hodina " + esc(slunce.zlataOd) + "–" + esc(slunce.zlataDo) + "</p>";
    }
    if (milnik) html += '<p class="karta-meta">Milník stavby: ' + esc(milnik.nazev) + "</p>";

    var polozky = n.co_se_toci || [];
    if (polozky.length) {
      html += '<p class="karta-meta" style="margin-top:8px"><strong>Co se točí:</strong></p><ul style="margin:4px 0 0 18px;padding:0">';
      polozky.forEach(function (p) {
        html += "<li>" + esc(p.text) + "</li>";
      });
      html += "</ul>";
    }

    html += '<p class="karta-meta" style="margin-top:8px">Za stavbu: ' + htmlZaStavbu(n, lide) + "</p>";
    html += '<p class="karta-meta">Za nás: ' + esc(seznamOsobPodleId(n.za_nas, lide)) + "</p>";

    html += '<div class="karta-akce">';
    html += '<button type="button" class="btn btn-sekundarni" data-prehled-akce="svolavka" data-id="' + esc(n.id) + '">Kopírovat svolávku</button>';
    html += '<button type="button" class="btn btn-sekundarni" data-prehled-akce="ics" data-id="' + esc(n.id) + '">Do kalendáře</button>';
    html += "</div></section>";
    return html;
  }

  // ---- upozornění ----

  function htmlUpozorneni(nastaveni, navstevy, materialy, smiSpravovatNastaveni) {
    var html = '<section class="oddil" id="prehled-upozorneni">';
    html += '<h2 class="nadpis-sekce">Upozornění</h2>';

    var zobrazeno = false;

    // INTERNÍ — jen pro náš tým (strana FD). Je v tom naše obchodní pozice
    // vůči PORR (kolik nám v rozsahu chybí a že chceme dodatek) a do kokpitu
    // chodí i Lucie s Veronikou za PORR a lidé z Metrostavu.
    var jenNas = typeof App.jsemZaFD === "function" ? App.jsemZaFD() : false;
    var upoz = nastaveni.interni_upozorneni || null;
    if (jenNas && upoz && upoz.text && !nastaveni.upozorneni_skryto) {
      zobrazeno = true;
      html += '<div class="karta-upozorneni" style="margin-bottom:12px">';
      html += '<span class="karta-upozorneni-ikona" aria-hidden="true"></span>';
      html += '<div class="karta-upozorneni-obsah">';
      html += '<div class="karta-upozorneni-nadpis">' + esc(upoz.nadpis || "Interní upozornění") +
        ' <span class="stitek">jen pro nás</span></div>';
      // Text jde z privátního datového repa (nastaveni.data.interni_upozorneni),
      // ne z veřejného JS — je v něm naše obchodní pozice vůči PORR a veřejný
      // repo je čitelný komukoli (audit 30. 8. 2026).
      html += "<p>" + esc(upoz.text || "") + "</p>";
      html += "</div>";
      if (smiSpravovatNastaveni) {
        html += '<button type="button" class="karta-upozorneni-zavrit" data-prehled-akce="skryt-upozorneni" aria-label="Skrýt upozornění">×</button>';
      }
      html += "</div>";
    }

    var dalsi = [];

    // dodatek §B.3 — protiplnění pro Emauzský klášter
    var emauzy = materialy.filter(function (m) { return !m.smazano && m.prijemce === "Emauzy"; });
    var emauzyHotovo = emauzy.filter(function (m) { return m.stav === "hotovo" || m.stav === "predano"; });
    if (emauzyHotovo.length === 0) {
      dalsi.push("Materiál pro Emauzský klášter zatím nebyl dodán — je to protiplnění za kameru na balkoně.");
    }

    // expirující MyAirBridge odkazy
    var expirujici = materialy.filter(function (m) {
      if (m.smazano || !m.myairbridge || !m.myairbridge.expiruje) return false;
      var dny = Util.zaDni(m.myairbridge.expiruje);
      return dny <= 14;
    });
    expirujici.sort(function (a, b) { return a.myairbridge.expiruje.localeCompare(b.myairbridge.expiruje); });
    expirujici.forEach(function (m) {
      var dny = Util.zaDni(m.myairbridge.expiruje);
      dalsi.push("MyAirBridge „" + esc(m.nazev) + "“ — " + esc(popisekExpirace(dny)) + ".");
    });

    // čeká na schválení
    var cekajici = navstevy.filter(function (n) { return !n.smazano && n.stav === "ke-schvaleni"; });
    if (cekajici.length > 0) {
      dalsi.push('<a href="#navstevy">' + cekajici.length + " návštěv(y) čeká na schválení</a> — otevřít v sekci Návštěvy.");
    }

    if (dalsi.length) {
      zobrazeno = true;
      html += '<ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px">';
      dalsi.forEach(function (text) {
        html += '<li class="karta-upozorneni" style="padding:10px 14px">' +
          '<span class="karta-upozorneni-ikona" aria-hidden="true"></span>' +
          '<span class="karta-upozorneni-obsah">' + text + "</span></li>";
      });
      html += "</ul>";
    }

    if (!zobrazeno) {
      html += '<p class="podnadpis-sekce" style="margin:0">Žádná upozornění.</p>';
    }

    html += "</section>";
    return html;
  }

  // ---- plnění rozsahu (4 pruhy) ----

  function pruh(popisek, aktualni, max) {
    var proc = max > 0 ? Math.min(100, (aktualni / max) * 100) : 0;
    return '<div class="progress-radek">' +
      '<div class="progress-popisek"><span>' + esc(popisek) + "</span><span>" + aktualni + " / " + max + "</span></div>" +
      '<div class="progress"><div class="progress-vyplneno' + (aktualni >= max && max > 0 ? " progress-plno" : "") +
      '" style="width:' + proc.toFixed(1) + '%"></div></div></div>';
  }

  function htmlRozsah(nastaveni, navstevy, materialy) {
    var rozsah = nastaveni.rozsah || {};
    var probehle = navstevy.filter(function (n) { return !n.smazano && n.stav === "probehlo"; });

    var foto = probehle.reduce(function (s, n) { return s + ((n.cerpa && n.cerpa.foto) || 0); }, 0);
    var dron = probehle.reduce(function (s, n) { return s + ((n.cerpa && n.cerpa.dron) || 0); }, 0);

    var porrMaterialy = materialy.filter(function (m) { return !m.smazano && jePorr(m); });
    var prubezna = porrMaterialy.filter(function (m) {
      return m.nazev.indexOf("Průběžné video") === 0 && (m.stav === "hotovo" || m.stav === "predano");
    }).length;
    var souhrnne = porrMaterialy.filter(function (m) {
      return m.nazev.indexOf("Souhrnné video") === 0 && (m.stav === "hotovo" || m.stav === "predano");
    }).length;

    var html = '<section class="oddil"><h2 class="nadpis-sekce">Plnění rozsahu</h2>';
    html += pruh("Foto sezení", foto, rozsah.foto_sezeni || 0);
    html += pruh("Dron bloky", dron, rozsah.dron_bloky || 0);
    html += pruh("Průběžná videa", prubezna, rozsah.videa_prubezna || 0);
    html += pruh("Souhrnné video", souhrnne, rozsah.video_souhrnne || 0);
    html += "</section>";
    return html;
  }

  // ---- poslední aktivita ----

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

  function htmlAktivita(aktivita, navstevy, plan, materialy, lide) {
    var polozky = aktivita
      .filter(function (a) { return !a.smazano; })
      .slice()
      .sort(function (a, b) { return String(b.kdy).localeCompare(String(a.kdy)); })
      .slice(0, 15);

    var html = '<section class="oddil"><h2 class="nadpis-sekce">Poslední aktivita</h2>';
    if (!polozky.length) {
      html += '<p class="podnadpis-sekce" style="margin:0">Zatím žádná aktivita.</p></section>';
      return html;
    }

    html += '<div style="display:flex;flex-direction:column;gap:8px">';
    polozky.forEach(function (a) {
      var znacka = a.druh === "komentar" ? "Komentář" : "Změna";
      html += '<div class="karta" style="padding:10px 14px">' +
        '<div class="karta-meta"><strong>' + esc(znacka) + "</strong> · " + esc(popisEntity(a, navstevy, plan, materialy, lide)) +
        " · " + esc(jmenoAutora(a.kdo, lide)) + " · " + esc(Util.formatCas(a.kdy)) + "</div>" +
        '<div class="karta-popis">' + esc(a.text || "") + "</div></div>";
    });
    html += "</div></section>";
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

    var smiSpravovatNastaveni = !!(window.Auth && Auth.can && Auth.can("nastaveni.upravit"));
    var dalsi = vyberDalsiNatoceni(navstevy.filter(function (n) { return !n.smazano; }));

    var html = '<div id="prehled-chyba" class="chyba-hlaska" hidden></div>';
    html += htmlHlavicka(nastaveni);
    html += htmlDalsiNatoceni(dalsi, lide, plan, nastaveni);
    html += htmlUpozorneni(nastaveni, navstevy, materialy, smiSpravovatNastaveni);
    html += htmlRozsah(nastaveni, navstevy, materialy);
    html += htmlAktivita(aktivita, navstevy, plan, materialy, lide);

    cil.innerHTML = html;
    napojPosluchace(cil);
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
    });
  }

  // ---- registrace sekce (viz vysvětlení v view-lide.js) ----

  document.addEventListener("DOMContentLoaded", function () {
    if (window.App && typeof App.registrujSekci === "function") {
      App.registrujSekci("prehled", vykresli);
    }
  });
})();
