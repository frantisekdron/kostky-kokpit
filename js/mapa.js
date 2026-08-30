/*
 * mapa.js — vlastní mapa nad dlaždicemi OpenStreetMap (KONTRAKT_DODATEK.md §A.5).
 *
 * ŽÁDNÝ Leaflet, žádné CDN skripty, žádné API klíče. Dlaždice jsou obyčejné
 * <img> z https://tile.openstreetmap.org/{z}/{x}/{y}.png s loading="lazy"
 * a referrerpolicy="no-referrer". Když se dlaždice nenačtou (blokovaná síť,
 * offline), mapa NESMÍ spadnout — místo ní se ukáže šedé pole s hláškou
 * „Mapu se nepodařilo načíst" a souřadnicemi.
 *
 * Vystavuje globální objekt Mapa:
 *   Mapa.vytvor(kontejner, {lat, lon, zoom, klikatelna, naZmenu, popisek})
 *       -> instance mapy s jedním bodem. `klikatelna: true` znamená, že klik
 *          do mapy spočítá souřadnice a zavolá naZmenu({lat, lon}).
 *          Vrací { nastavBod, stred, znic, prekresli } (viz níže).
 *   Mapa.vytvorPrehled(kontejner, body, {naKlik})
 *       -> přehledová mapa s více body. body = pole
 *          { lat, lon, druh: "misto" | "snimek", cislo, popisek, id }.
 *          Místa dostanou velký marker v barvě --akcent s číslem, snímky
 *          z náletu malé tlumené tečky. Zoom se dopočítá z ohraničujícího
 *          obdélníku všech bodů (rozsah 15–19). Klik na marker → naKlik(bod).
 *   Mapa.odkazMapyCz(lat, lon)  -> URL na mapy.cz
 *   Mapa.odkazGoogle(lat, lon)  -> URL na Google Maps
 *   Mapa.souradnice(lat, lon)   -> "50,123456 · 14,123456" (český formát)
 *   Mapa.ZOOM_MIN / ZOOM_MAX / ZOOM_VYCHOZI
 *
 * Instance mapy (návratová hodnota vytvor/vytvorPrehled):
 *   .nastavBod(lat, lon)   přesune (nebo zruší, s null) hlavní bod
 *   .stred()               -> { lat, lon, zoom }
 *   .prekresli()           překreslí dlaždice a markery
 *   .znic()                odpojí posluchače a vyprázdní kontejner
 *
 * Web Mercator (§A.5):
 *   x = (lon + 180) / 360 · 2^z
 *   y = (1 − ln(tan φ + sec φ) / π) / 2 · 2^z
 *
 * Nic jiného ven nevystavuje; veškerý stav je uvnitř uzávěrky instance.
 */

var Mapa = (function () {
  "use strict";

  var VELIKOST_DLAZDICE = 256;
  var ZOOM_MIN = 15;
  var ZOOM_MAX = 19;
  var ZOOM_VYCHOZI = 18;
  var PRAH_KLIKU_PX = 6; // posun do 6 px se ještě počítá jako klik, ne tažení
  var CEKANI_NA_DLAZDICE_MS = 8000;

  // ------------------------------------------------------------------
  // Web Mercator — převod souřadnic na pixely světa a zpět
  // ------------------------------------------------------------------

  function jeCislo(hodnota) {
    return typeof hodnota === "number" && isFinite(hodnota);
  }

  function platnyBod(lat, lon) {
    return jeCislo(lat) && jeCislo(lon) && lat > -85.05 && lat < 85.05 && lon >= -180 && lon <= 180;
  }

  function omez(hodnota, min, max) {
    if (hodnota < min) return min;
    if (hodnota > max) return max;
    return hodnota;
  }

  // Pixelová pozice ve „světě" dané úrovně zoomu (2^z dlaždic po 256 px).
  function svetovyBod(lat, lon, zoom) {
    var pocetPixelu = VELIKOST_DLAZDICE * Math.pow(2, zoom);
    var fi = (omez(lat, -85.05112878, 85.05112878) * Math.PI) / 180;
    var x = ((lon + 180) / 360) * pocetPixelu;
    var y = ((1 - Math.log(Math.tan(fi) + 1 / Math.cos(fi)) / Math.PI) / 2) * pocetPixelu;
    return { x: x, y: y };
  }

  // Inverze k svetovyBod.
  function bodZeSveta(x, y, zoom) {
    var pocetPixelu = VELIKOST_DLAZDICE * Math.pow(2, zoom);
    var lon = (x / pocetPixelu) * 360 - 180;
    var n = Math.PI - (2 * Math.PI * y) / pocetPixelu;
    var lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return { lat: lat, lon: lon };
  }

  // ------------------------------------------------------------------
  // Odkazy do externích map a formátování souřadnic
  // ------------------------------------------------------------------

  function odkazMapyCz(lat, lon) {
    return "https://mapy.cz/zakladni?y=" + encodeURIComponent(lat) + "&x=" + encodeURIComponent(lon) + "&z=18";
  }

  function odkazGoogle(lat, lon) {
    return "https://www.google.com/maps?q=" + encodeURIComponent(lat + "," + lon);
  }

  function souradnice(lat, lon) {
    if (!platnyBod(lat, lon)) return "—";
    return lat.toFixed(6).replace(".", ",") + " · " + lon.toFixed(6).replace(".", ",");
  }

  // ------------------------------------------------------------------
  // Šedé náhradní pole, když se dlaždice nepodaří načíst (§A.5)
  // ------------------------------------------------------------------

  function vytvorNahradu(lat, lon) {
    var nahrada = document.createElement("div");
    nahrada.className = "mapa-nahrada";

    var hlaska = document.createElement("p");
    hlaska.className = "mapa-nahrada-hlaska";
    hlaska.textContent = "Mapu se nepodařilo načíst";
    nahrada.appendChild(hlaska);

    var souradniceEl = document.createElement("p");
    souradniceEl.className = "mapa-nahrada-souradnice";
    souradniceEl.textContent = platnyBod(lat, lon) ? souradnice(lat, lon) : "Souřadnice nejsou zadané.";
    nahrada.appendChild(souradniceEl);

    return nahrada;
  }

  // ------------------------------------------------------------------
  // Povinná atribuce + odkazy do externích map (§A.5)
  // ------------------------------------------------------------------

  function vytvorPaticku(lat, lon) {
    var paticka = document.createElement("div");
    paticka.className = "mapa-paticka";

    var atribuce = document.createElement("span");
    atribuce.className = "mapa-atribuce";
    atribuce.appendChild(document.createTextNode("© "));
    var odkazOsm = document.createElement("a");
    odkazOsm.href = "https://www.openstreetmap.org/copyright";
    odkazOsm.target = "_blank";
    odkazOsm.rel = "noopener noreferrer";
    odkazOsm.textContent = "přispěvatelé OpenStreetMap";
    atribuce.appendChild(odkazOsm);
    paticka.appendChild(atribuce);

    if (platnyBod(lat, lon)) {
      var odkazy = document.createElement("span");
      odkazy.className = "mapa-odkazy";

      var mapyCz = document.createElement("a");
      mapyCz.href = odkazMapyCz(lat, lon);
      mapyCz.target = "_blank";
      mapyCz.rel = "noopener noreferrer";
      mapyCz.textContent = "Mapy.cz";
      odkazy.appendChild(mapyCz);

      var google = document.createElement("a");
      google.href = odkazGoogle(lat, lon);
      google.target = "_blank";
      google.rel = "noopener noreferrer";
      google.textContent = "Google Maps";
      odkazy.appendChild(google);

      paticka.appendChild(odkazy);
    }

    return paticka;
  }

  // ------------------------------------------------------------------
  // Jádro: jedna instance mapy
  // ------------------------------------------------------------------
  //
  // nastaveni:
  //   lat, lon      výchozí střed (a hlavní bod, pokud nejsou markery)
  //   zoom          15–19, výchozí 18
  //   klikatelna    true = klik do mapy volá naZmenu({lat, lon})
  //   naZmenu       fn({lat, lon})
  //   markery       pole { lat, lon, druh, cislo, popisek, id } (přehledová mapa)
  //   naKlikMarker  fn(marker) — klik na marker
  //   bezBodu       true = nekreslit hlavní marker (i když je střed platný)
  //   fitBody       true = zoom dopočítat z ohraničujícího obdélníku markerů

  function vytvorInstanci(kontejner, nastaveni) {
    nastaveni = nastaveni || {};

    var stredLat = jeCislo(nastaveni.lat) ? nastaveni.lat : null;
    var stredLon = jeCislo(nastaveni.lon) ? nastaveni.lon : null;
    var zoom = omez(jeCislo(nastaveni.zoom) ? Math.round(nastaveni.zoom) : ZOOM_VYCHOZI, ZOOM_MIN, ZOOM_MAX);
    var markery = Array.isArray(nastaveni.markery) ? nastaveni.markery.slice() : [];
    var hlavniBod = nastaveni.bezBodu ? null : platnyBod(stredLat, stredLon) ? { lat: stredLat, lon: stredLon } : null;

    // Když nemáme vůbec žádnou souřadnici, spadneme rovnou do náhrady —
    // není co ukázat a nemá smysl tahat dlaždice.
    if (!platnyBod(stredLat, stredLon)) {
      while (kontejner.firstChild) kontejner.removeChild(kontejner.firstChild);
      kontejner.classList.add("mapa");
      kontejner.appendChild(vytvorNahradu(null, null));
      return {
        nastavBod: function () {},
        stred: function () { return { lat: null, lon: null, zoom: zoom }; },
        prekresli: function () {},
        znic: function () {}
      };
    }

    // ---- DOM kostra ----

    while (kontejner.firstChild) kontejner.removeChild(kontejner.firstChild);
    kontejner.classList.add("mapa");

    var platno = document.createElement("div");
    platno.className = "mapa-platno";
    if (nastaveni.klikatelna) platno.classList.add("mapa-platno-klikatelna");
    platno.setAttribute("role", "img");
    platno.setAttribute(
      "aria-label",
      nastaveni.popisek || "Mapa okolí, souřadnice " + souradnice(stredLat, stredLon)
    );

    var vrstvaDlazdic = document.createElement("div");
    vrstvaDlazdic.className = "mapa-dlazdice";
    platno.appendChild(vrstvaDlazdic);

    var vrstvaMarkeru = document.createElement("div");
    vrstvaMarkeru.className = "mapa-markery";
    platno.appendChild(vrstvaMarkeru);

    var ovladani = document.createElement("div");
    ovladani.className = "mapa-ovladani";
    var btnPlus = document.createElement("button");
    btnPlus.type = "button";
    btnPlus.className = "mapa-tlacitko";
    btnPlus.textContent = "+";
    btnPlus.setAttribute("aria-label", "Přiblížit mapu");
    var btnMinus = document.createElement("button");
    btnMinus.type = "button";
    btnMinus.className = "mapa-tlacitko";
    btnMinus.textContent = "−";
    btnMinus.setAttribute("aria-label", "Oddálit mapu");
    ovladani.appendChild(btnPlus);
    ovladani.appendChild(btnMinus);
    platno.appendChild(ovladani);

    if (nastaveni.klikatelna) {
      var napoveda = document.createElement("p");
      napoveda.className = "mapa-napoveda";
      napoveda.textContent = "Klikni do mapy a urči bod.";
      platno.appendChild(napoveda);
    }

    kontejner.appendChild(platno);
    kontejner.appendChild(vytvorPaticku(stredLat, stredLon));

    // ---- stav ----

    var zniceno = false;
    var selhalo = false;       // režim náhrady (šedé pole)
    var nactenaAsponJedna = false;
    var casovacNahrady = null;
    var pozorovatelVelikosti = null;
    var naplanovanyRam = null;

    function rozmery() {
      var sirka = platno.clientWidth || kontejner.clientWidth || 0;
      var vyska = platno.clientHeight || 0;
      return { sirka: sirka, vyska: vyska };
    }

    function prepniNaNahradu() {
      if (zniceno || selhalo) return;
      selhalo = true;
      while (platno.firstChild) platno.removeChild(platno.firstChild);
      platno.classList.add("mapa-platno-selhalo");
      platno.appendChild(vytvorNahradu(stredLat, stredLon));
    }

    // Pojistka: když se do 8 s nenačte ani jedna dlaždice (blokovaná síť,
    // offline), přepneme na šedé pole. onerror u <img> to většinou zvládne
    // dřív, tohle je záchrana pro případ, kdy požadavek jen visí.
    function spustCasovacNahrady() {
      if (casovacNahrady !== null) return;
      casovacNahrady = window.setTimeout(function () {
        casovacNahrady = null;
        if (!nactenaAsponJedna) prepniNaNahradu();
      }, CEKANI_NA_DLAZDICE_MS);
    }

    // ---- vykreslení dlaždic ----

    function vykresliDlazdice(rozmer) {
      var stred = svetovyBod(stredLat, stredLon, zoom);
      var levyHorniX = stred.x - rozmer.sirka / 2;
      var levyHorniY = stred.y - rozmer.vyska / 2;
      var pocetDlazdic = Math.pow(2, zoom);

      var odX = Math.floor(levyHorniX / VELIKOST_DLAZDICE);
      var doX = Math.floor((levyHorniX + rozmer.sirka) / VELIKOST_DLAZDICE);
      var odY = Math.floor(levyHorniY / VELIKOST_DLAZDICE);
      var doY = Math.floor((levyHorniY + rozmer.vyska) / VELIKOST_DLAZDICE);

      while (vrstvaDlazdic.firstChild) vrstvaDlazdic.removeChild(vrstvaDlazdic.firstChild);

      var celkem = 0;
      var chyb = 0;

      for (var ty = odY; ty <= doY; ty++) {
        if (ty < 0 || ty >= pocetDlazdic) continue;
        for (var tx = odX; tx <= doX; tx++) {
          // vodorovné omotání zeměkoule (u nás se nestane, ale ať to nepadá)
          var txOmotane = ((tx % pocetDlazdic) + pocetDlazdic) % pocetDlazdic;
          var obrazek = document.createElement("img");
          obrazek.className = "mapa-dlazdice-obrazek";
          obrazek.alt = "";
          obrazek.loading = "lazy";
          obrazek.decoding = "async";
          obrazek.referrerPolicy = "no-referrer";
          obrazek.width = VELIKOST_DLAZDICE;
          obrazek.height = VELIKOST_DLAZDICE;
          obrazek.style.left = Math.round(tx * VELIKOST_DLAZDICE - levyHorniX) + "px";
          obrazek.style.top = Math.round(ty * VELIKOST_DLAZDICE - levyHorniY) + "px";
          obrazek.addEventListener("load", function () {
            nactenaAsponJedna = true;
          });
          obrazek.addEventListener("error", function () {
            chyb++;
            // Až když selžou úplně všechny dlaždice a žádná se nikdy
            // nenačetla, přepneme na náhradu — jedna chybějící dlaždice
            // na okraji mapu neshodí.
            if (!nactenaAsponJedna && chyb >= celkem) prepniNaNahradu();
          });
          obrazek.src =
            "https://tile.openstreetmap.org/" + zoom + "/" + txOmotane + "/" + ty + ".png";
          vrstvaDlazdic.appendChild(obrazek);
          celkem++;
        }
      }

      if (celkem === 0) {
        prepniNaNahradu();
      } else {
        spustCasovacNahrady();
      }
    }

    // ---- vykreslení markerů ----

    function vytvorMarker(marker, rozmer, stred) {
      var bod = svetovyBod(marker.lat, marker.lon, zoom);
      var x = bod.x - stred.x + rozmer.sirka / 2;
      var y = bod.y - stred.y + rozmer.vyska / 2;
      // markery mimo výřez zahodíme, ať se DOM zbytečně nenafukuje
      if (x < -40 || y < -60 || x > rozmer.sirka + 40 || y > rozmer.vyska + 60) return null;

      var jeMisto = marker.druh !== "snimek";
      var klikaci = typeof marker.naKlik === "function" || typeof nastaveni.naKlikMarker === "function";
      var prvek = document.createElement(klikaci ? "button" : "div");
      if (klikaci) prvek.type = "button";
      // Statický marker nesmí brát myš — jinak by se mapa nedala táhnout,
      // když člověk chytne zrovna špendlík.
      prvek.className =
        (jeMisto ? "mapa-marker" : "mapa-marker mapa-marker-snimek") +
        (klikaci ? "" : " mapa-marker-staticky");
      prvek.style.left = Math.round(x) + "px";
      prvek.style.top = Math.round(y) + "px";

      var popisek = marker.popisek || (jeMisto ? "Vybrané místo" : "Snímek z náletu");
      prvek.title = popisek;
      if (klikaci) prvek.setAttribute("aria-label", popisek);

      if (jeMisto) {
        var kolecko = document.createElement("span");
        kolecko.className = "mapa-marker-kolecko";
        kolecko.textContent = marker.cislo === undefined || marker.cislo === null ? "" : String(marker.cislo);
        prvek.appendChild(kolecko);
      }

      if (klikaci) {
        prvek.addEventListener("click", function (udalost) {
          udalost.preventDefault();
          udalost.stopPropagation();
          var fn = marker.naKlik || nastaveni.naKlikMarker;
          if (typeof fn === "function") fn(marker);
        });
        prvek.addEventListener("mousedown", function (udalost) {
          udalost.stopPropagation();
        });
      }

      return prvek;
    }

    function vykresliMarkery(rozmer) {
      var stred = svetovyBod(stredLat, stredLon, zoom);
      while (vrstvaMarkeru.firstChild) vrstvaMarkeru.removeChild(vrstvaMarkeru.firstChild);

      // nejdřív tlumené tečky snímků, aby velké markery míst byly nad nimi
      var serazene = markery.slice().sort(function (a, b) {
        var va = a.druh === "snimek" ? 0 : 1;
        var vb = b.druh === "snimek" ? 0 : 1;
        return va - vb;
      });

      serazene.forEach(function (marker) {
        if (!platnyBod(marker.lat, marker.lon)) return;
        var prvek = vytvorMarker(marker, rozmer, stred);
        if (prvek) vrstvaMarkeru.appendChild(prvek);
      });

      if (hlavniBod && platnyBod(hlavniBod.lat, hlavniBod.lon)) {
        var hlavni = vytvorMarker(
          { lat: hlavniBod.lat, lon: hlavniBod.lon, druh: "misto", popisek: nastaveni.popisek || "Bod" },
          rozmer,
          stred
        );
        if (hlavni) vrstvaMarkeru.appendChild(hlavni);
      }
    }

    // ---- překreslení celku ----

    function prekresli() {
      if (zniceno || selhalo) return;
      var rozmer = rozmery();
      if (rozmer.sirka < 20 || rozmer.vyska < 20) return; // kontejner ještě nemá rozměr
      try {
        vykresliDlazdice(rozmer);
        vykresliMarkery(rozmer);
      } catch (chyba) {
        console.warn("Mapa: vykreslení selhalo, přepínám na náhradu.", chyba);
        prepniNaNahradu();
      }
    }

    function naplanujPrekresleni() {
      if (zniceno || naplanovanyRam !== null) return;
      naplanovanyRam = window.requestAnimationFrame(function () {
        naplanovanyRam = null;
        prekresli();
      });
    }

    // ---- zoom ----

    function zmenZoom(o) {
      var novy = omez(zoom + o, ZOOM_MIN, ZOOM_MAX);
      if (novy === zoom) return;
      zoom = novy;
      prekresli();
    }

    btnPlus.addEventListener("click", function (udalost) {
      udalost.preventDefault();
      udalost.stopPropagation();
      zmenZoom(1);
    });
    btnMinus.addEventListener("click", function (udalost) {
      udalost.preventDefault();
      udalost.stopPropagation();
      zmenZoom(-1);
    });
    btnPlus.addEventListener("mousedown", function (u) { u.stopPropagation(); });
    btnMinus.addEventListener("mousedown", function (u) { u.stopPropagation(); });

    // ---- tažení myší i prstem ----

    var tazeniAktivni = false;
    var zacatek = null;   // { x, y } v pixelech obrazovky
    var zacatekSvet = null; // { x, y } světové pixely středu při začátku tažení
    var ujeto = 0;

    function zacniTazeni(x, y) {
      if (selhalo) return;
      tazeniAktivni = true;
      ujeto = 0;
      zacatek = { x: x, y: y };
      zacatekSvet = svetovyBod(stredLat, stredLon, zoom);
      platno.classList.add("mapa-platno-tazeni");
    }

    function posunTazeni(x, y) {
      if (!tazeniAktivni || !zacatek) return;
      var dx = x - zacatek.x;
      var dy = y - zacatek.y;
      ujeto = Math.max(ujeto, Math.abs(dx) + Math.abs(dy));
      var novy = bodZeSveta(zacatekSvet.x - dx, zacatekSvet.y - dy, zoom);
      stredLat = omez(novy.lat, -85.05, 85.05);
      stredLon = omez(novy.lon, -180, 180);
      naplanujPrekresleni();
    }

    function ukonciTazeni() {
      tazeniAktivni = false;
      zacatek = null;
      platno.classList.remove("mapa-platno-tazeni");
    }

    function naMouseDown(udalost) {
      if (udalost.button !== 0) return;
      udalost.preventDefault();
      zacniTazeni(udalost.clientX, udalost.clientY);
    }

    function naMouseMove(udalost) {
      if (!tazeniAktivni) return;
      posunTazeni(udalost.clientX, udalost.clientY);
    }

    function naMouseUp() {
      if (!tazeniAktivni) return;
      ukonciTazeni();
    }

    function naTouchStart(udalost) {
      if (!udalost.touches || udalost.touches.length !== 1) return;
      zacniTazeni(udalost.touches[0].clientX, udalost.touches[0].clientY);
    }

    function naTouchMove(udalost) {
      if (!tazeniAktivni || !udalost.touches || udalost.touches.length !== 1) return;
      udalost.preventDefault(); // ať se nehýbe celá stránka
      posunTazeni(udalost.touches[0].clientX, udalost.touches[0].clientY);
    }

    function naTouchEnd() {
      if (!tazeniAktivni) return;
      ukonciTazeni();
    }

    // Klik do mapy (jen když se netáhlo) — spočítá lat/lon pod kurzorem.
    function naKlikDoMapy(udalost) {
      if (selhalo || !nastaveni.klikatelna) return;
      if (ujeto > PRAH_KLIKU_PX) return;
      var rozmer = rozmery();
      if (rozmer.sirka < 20 || rozmer.vyska < 20) return;
      var obdelnik = platno.getBoundingClientRect();
      var x = udalost.clientX - obdelnik.left;
      var y = udalost.clientY - obdelnik.top;
      var stred = svetovyBod(stredLat, stredLon, zoom);
      var novy = bodZeSveta(stred.x - rozmer.sirka / 2 + x, stred.y - rozmer.vyska / 2 + y, zoom);
      hlavniBod = { lat: novy.lat, lon: novy.lon };
      prekresli();
      if (typeof nastaveni.naZmenu === "function") {
        nastaveni.naZmenu({ lat: novy.lat, lon: novy.lon });
      }
    }

    platno.addEventListener("mousedown", naMouseDown);
    window.addEventListener("mousemove", naMouseMove);
    window.addEventListener("mouseup", naMouseUp);
    platno.addEventListener("touchstart", naTouchStart, { passive: true });
    platno.addEventListener("touchmove", naTouchMove, { passive: false });
    platno.addEventListener("touchend", naTouchEnd);
    platno.addEventListener("touchcancel", naTouchEnd);
    platno.addEventListener("click", naKlikDoMapy);

    // ---- reakce na změnu velikosti kontejneru (modal, otočení telefonu) ----

    if (typeof window.ResizeObserver === "function") {
      pozorovatelVelikosti = new window.ResizeObserver(function () {
        naplanujPrekresleni();
      });
      pozorovatelVelikosti.observe(platno);
    } else {
      window.addEventListener("resize", naplanujPrekresleni);
    }

    // Kontejner v modálu ještě nemá rozměr — první kreslení až po layoutu.
    naplanujPrekresleni();

    // ---- veřejné API instance ----

    function fitNaMarkery() {
      var vsechny = markery.filter(function (m) { return platnyBod(m.lat, m.lon); });
      if (hlavniBod) vsechny.push(hlavniBod);
      if (!vsechny.length) return;
      var minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
      vsechny.forEach(function (m) {
        if (m.lat < minLat) minLat = m.lat;
        if (m.lat > maxLat) maxLat = m.lat;
        if (m.lon < minLon) minLon = m.lon;
        if (m.lon > maxLon) maxLon = m.lon;
      });
      stredLat = (minLat + maxLat) / 2;
      stredLon = (minLon + maxLon) / 2;
      var rozmer = rozmery();
      var sirka = rozmer.sirka > 20 ? rozmer.sirka : 320;
      var vyska = rozmer.vyska > 20 ? rozmer.vyska : 260;
      var nalezeny = ZOOM_MIN;
      for (var z = ZOOM_MAX; z >= ZOOM_MIN; z--) {
        var levyHorni = svetovyBod(maxLat, minLon, z);
        var pravyDolni = svetovyBod(minLat, maxLon, z);
        if (pravyDolni.x - levyHorni.x <= sirka * 0.82 && pravyDolni.y - levyHorni.y <= vyska * 0.82) {
          nalezeny = z;
          break;
        }
      }
      zoom = nalezeny;
    }

    if (nastaveni.fitBody) {
      // fit se musí zopakovat, jakmile kontejner dostane skutečný rozměr
      var puvodniPrekresli = prekresli;
      var fitHotovy = false;
      prekresli = function () {
        if (!fitHotovy) {
          var rozmer = rozmery();
          if (rozmer.sirka >= 20 && rozmer.vyska >= 20) {
            fitNaMarkery();
            fitHotovy = true;
          }
        }
        puvodniPrekresli();
      };
      fitNaMarkery();
    }

    return {
      nastavBod: function (lat, lon) {
        if (platnyBod(lat, lon)) {
          hlavniBod = { lat: lat, lon: lon };
          stredLat = lat;
          stredLon = lon;
        } else {
          hlavniBod = null;
        }
        prekresli();
      },
      stred: function () {
        return { lat: stredLat, lon: stredLon, zoom: zoom };
      },
      prekresli: function () {
        prekresli();
      },
      znic: function () {
        if (zniceno) return;
        zniceno = true;
        if (casovacNahrady !== null) window.clearTimeout(casovacNahrady);
        if (naplanovanyRam !== null) window.cancelAnimationFrame(naplanovanyRam);
        window.removeEventListener("mousemove", naMouseMove);
        window.removeEventListener("mouseup", naMouseUp);
        window.removeEventListener("resize", naplanujPrekresleni);
        if (pozorovatelVelikosti) pozorovatelVelikosti.disconnect();
        while (kontejner.firstChild) kontejner.removeChild(kontejner.firstChild);
      }
    };
  }

  // ------------------------------------------------------------------
  // Mapa.vytvor — jeden bod (§A.5)
  // ------------------------------------------------------------------

  function vytvor(kontejner, nastaveni) {
    nastaveni = nastaveni || {};
    if (!kontejner || typeof kontejner.appendChild !== "function") {
      console.warn("Mapa.vytvor: chybí kontejner.");
      return null;
    }
    try {
      return vytvorInstanci(kontejner, {
        lat: nastaveni.lat,
        lon: nastaveni.lon,
        zoom: nastaveni.zoom,
        klikatelna: !!nastaveni.klikatelna,
        naZmenu: nastaveni.naZmenu,
        popisek: nastaveni.popisek
      });
    } catch (chyba) {
      // Mapa nikdy nesmí shodit sekci — místo ní šedé pole.
      console.warn("Mapa.vytvor selhalo:", chyba);
      try {
        while (kontejner.firstChild) kontejner.removeChild(kontejner.firstChild);
        kontejner.classList.add("mapa");
        kontejner.appendChild(vytvorNahradu(nastaveni.lat, nastaveni.lon));
      } catch (chyba2) {
        console.warn("Mapa: nepodařilo se vykreslit ani náhradu.", chyba2);
      }
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Mapa.vytvorPrehled — všechny body najednou (§A.5)
  // ------------------------------------------------------------------

  function vytvorPrehled(kontejner, body, nastaveni) {
    nastaveni = nastaveni || {};
    if (!kontejner || typeof kontejner.appendChild !== "function") {
      console.warn("Mapa.vytvorPrehled: chybí kontejner.");
      return null;
    }
    var platne = (Array.isArray(body) ? body : []).filter(function (b) {
      return b && platnyBod(b.lat, b.lon);
    });

    if (!platne.length) {
      while (kontejner.firstChild) kontejner.removeChild(kontejner.firstChild);
      kontejner.classList.add("mapa");
      kontejner.appendChild(vytvorNahradu(null, null));
      return null;
    }

    var soucetLat = 0;
    var soucetLon = 0;
    platne.forEach(function (b) {
      soucetLat += b.lat;
      soucetLon += b.lon;
    });

    try {
      return vytvorInstanci(kontejner, {
        lat: soucetLat / platne.length,
        lon: soucetLon / platne.length,
        zoom: ZOOM_VYCHOZI,
        markery: platne,
        naKlikMarker: nastaveni.naKlik,
        bezBodu: true,
        fitBody: true,
        popisek: "Přehledová mapa vybraných míst a snímků z náletu"
      });
    } catch (chyba) {
      console.warn("Mapa.vytvorPrehled selhalo:", chyba);
      try {
        while (kontejner.firstChild) kontejner.removeChild(kontejner.firstChild);
        kontejner.classList.add("mapa");
        kontejner.appendChild(vytvorNahradu(platne[0].lat, platne[0].lon));
      } catch (chyba2) {
        console.warn("Mapa: nepodařilo se vykreslit ani náhradu.", chyba2);
      }
      return null;
    }
  }

  return {
    vytvor: vytvor,
    vytvorPrehled: vytvorPrehled,
    odkazMapyCz: odkazMapyCz,
    odkazGoogle: odkazGoogle,
    souradnice: souradnice,
    platnyBod: platnyBod,
    ZOOM_MIN: ZOOM_MIN,
    ZOOM_MAX: ZOOM_MAX,
    ZOOM_VYCHOZI: ZOOM_VYCHOZI
  };
})();
