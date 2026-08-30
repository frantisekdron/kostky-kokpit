/*
 * util.js — pomocne funkce pro Kokpit Pragerovy kostky.
 *
 * Vystavuje globalni objekt `Util` s temito metodami:
 *   Util.esc(text)                     — escapovani HTML (& < > " ')
 *   Util.formatDatum(iso, presnost, iso2) — cesky format datumu podle presnosti
 *   Util.denVTydnu(iso)                — nazev dne v tydnu
 *   Util.zaDni(iso)                    — pocet dni od dnes (zaporne = minulost)
 *   Util.formatOdpocet(dni)            — cesky text odpoctu ("za 12 dni", "zitra", ...)
 *   Util.formatCas(iso)                — datum+cas v Europe/Prague, kratky format
 *   Util.doSchranky(text)              — Promise<boolean>, kopie do schranky s fallbackem
 *   Util.svolavka(navsteva, data)      — text svolavky presne dle KONTRAKT.md §10.1
 *   Util.ics(navsteva, data)           — VCALENDAR/VEVENT string (RFC 5545)
 *   Util.stahni(nazevSouboru, obsah, mime) — stazeni souboru pres Blob
 *   Util.slunce(datumIso, lat, lon)    — vychod/zapad/zlata hodina (NOAA algoritmus)
 *   Util.velikostNaGb(text)            — cislo v GB z textu "13 GB" / "8,1 GB" / "512 MB"
 *
 * Zadne zavislosti, zadne CDN, cisty ES2020. Vsechny vnitrni pomocne funkce
 * (parsovani ISO data, Julianske datum, NOAA vypocet, ICS zalamovani radku, ...)
 * jsou soukrome uvnitr IIFE a ven se nedostanou.
 */

var Util = (function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Soukrome pomocne funkce
  // ---------------------------------------------------------------------

  var MESICE = [
    "leden", "únor", "březen", "duben", "květen", "červen",
    "červenec", "srpen", "září", "říjen", "listopad", "prosinec"
  ];

  var DNY_V_TYDNU = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];

  // Rozparsuje "YYYY-MM-DD" na cisla bez pouziti Date (aby nedoslo k
  // posunuti vlivem casove zony prohlizece).
  function parsujIso(iso) {
    var d = String(iso).split("-");
    return {
      rok: parseInt(d[0], 10),
      mesic: parseInt(d[1], 10),
      den: parseInt(d[2], 10)
    };
  }

  function dvojcislo(n) {
    n = Math.round(n);
    return n < 10 ? "0" + n : "" + n;
  }

  // Poslední neděle v daném měsíci (1-12) daného roku, jako číslo dne.
  function posledniNedeleVMesici(rok, mesic) {
    var d = new Date(Date.UTC(rok, mesic, 0)); // den 0 = posledni den mesice `mesic`
    var vahaDne = d.getUTCDay(); // 0 = nedele
    return d.getUTCDate() - vahaDne;
  }

  // Je dany kalendarni den v obdobi stredoevropskeho letniho casu?
  // Pravidlo: posledni nedele v breznu 02:00 -> posledni nedele v rijnu 03:00.
  // Na urovni cele dny (bez presneho casu prechodu) — presne dost pro nase pouziti.
  function jeLetniCas(rok, mesic, den) {
    var posledniBrezen = posledniNedeleVMesici(rok, 3);
    var posledniRijen = posledniNedeleVMesici(rok, 10);
    var datum = Date.UTC(rok, mesic - 1, den);
    var zacatek = Date.UTC(rok, 2, posledniBrezen);
    var konec = Date.UTC(rok, 9, posledniRijen);
    return datum >= zacatek && datum < konec;
  }

  function stupneNaRadiany(d) { return (d * Math.PI) / 180; }
  function radianyNaStupne(r) { return (r * 180) / Math.PI; }

  // Julianske datum (JDN) pro pravidnou (gregorianskou) kalendarni datum,
  // odpovida JD v 12:00 UT daneho dne — presne to, co NOAA vypocet potrebuje.
  function julianskyDen(rok, mesic, den) {
    var a = Math.floor((14 - mesic) / 12);
    var y = rok + 4800 - a;
    var m = mesic + 12 * a - 3;
    return (
      den +
      Math.floor((153 * m + 2) / 5) +
      365 * y +
      Math.floor(y / 4) -
      Math.floor(y / 100) +
      Math.floor(y / 400) -
      32045
    );
  }

  // NOAA algoritmus vychodu/zapadu slunce. Vraci minuty od pulnoci UTC
  // (muze byt zaporne nebo > 1440, to se resi az pri prevodu na cas).
  function vypoctiSlunce(jd, lat, lon) {
    var T = (jd - 2451545.0) / 36525;
    var L0 = 280.46646 + T * (36000.76983 + T * 0.0003032);
    L0 = L0 % 360;
    if (L0 < 0) L0 += 360;

    var M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    var Mrad = stupneNaRadiany(M);

    var C =
      Math.sin(Mrad) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
      Math.sin(2 * Mrad) * (0.019993 - 0.000101 * T) +
      Math.sin(3 * Mrad) * 0.000289;

    var trueLong = L0 + C;
    var apparentLong =
      trueLong - 0.00569 - 0.00478 * Math.sin(stupneNaRadiany(125.04 - 1934.136 * T));

    var meanObliq =
      23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    var obliqCorr = meanObliq + 0.00256 * Math.cos(stupneNaRadiany(125.04 - 1934.136 * T));

    var declin = radianyNaStupne(
      Math.asin(Math.sin(stupneNaRadiany(obliqCorr)) * Math.sin(stupneNaRadiany(apparentLong)))
    );

    var y = Math.tan(stupneNaRadiany(obliqCorr / 2));
    y *= y;
    var eqTime =
      4 *
      radianyNaStupne(
        y * Math.sin(2 * stupneNaRadiany(L0)) -
          2 * e * Math.sin(Mrad) +
          4 * e * y * Math.sin(Mrad) * Math.cos(2 * stupneNaRadiany(L0)) -
          0.5 * y * y * Math.sin(4 * stupneNaRadiany(L0)) -
          1.25 * e * e * Math.sin(2 * Mrad)
      );

    var zenit = 90.833; // vc. atmosfericke refrakce a polomeru slunce
    var latRad = stupneNaRadiany(lat);
    var declinRad = stupneNaRadiany(declin);
    var haArg =
      Math.cos(stupneNaRadiany(zenit)) / (Math.cos(latRad) * Math.cos(declinRad)) -
      Math.tan(latRad) * Math.tan(declinRad);
    // ochrana pro extremni sirky (polarni den/noc) — oriznuti do <-1, 1>
    if (haArg > 1) haArg = 1;
    if (haArg < -1) haArg = -1;
    var ha = radianyNaStupne(Math.acos(haArg));

    var solarNoon = 720 - 4 * lon - eqTime;
    var vychod = solarNoon - ha * 4;
    var zapad = solarNoon + ha * 4;

    return { vychod: vychod, zapad: zapad };
  }

  // Ceske sklonovani slova "den" pro cely nezaporny pocet.
  // forma: "za" (nominativ: den/dny/dni) nebo "pred" (instrumental: dnem/dny)
  function skloneniDnu(pocet, forma) {
    var abs = Math.abs(pocet);
    if (forma === "za") {
      if (abs === 1) return "den";
      if (abs >= 2 && abs <= 4) return "dny";
      return "dní";
    }
    // forma "pred"
    if (abs === 1) return "dnem";
    return "dny";
  }

  // ---------------------------------------------------------------------
  // ICS pomocne funkce (RFC 5545)
  // ---------------------------------------------------------------------

  function icsDelkaZnaku(znak) {
    var kod = znak.codePointAt(0);
    if (kod <= 0x7f) return 1;
    if (kod <= 0x7ff) return 2;
    if (kod <= 0xffff) return 3;
    return 4;
  }

  // Escapovani textove hodnoty dle RFC 5545 (§3.3.11): backslash, strednik,
  // carka a nove radky.
  function icsText(text) {
    return String(text)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r\n/g, "\\n")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\n");
  }

  // Zalomeni jednoho obsahoveho radku na max. 75 oktetu (UTF-8), pokracovaci
  // radky zacinaji mezerou (RFC 5545 §3.1).
  function zalomRadek(radek) {
    var znaky = Array.from(String(radek));
    var kusy = [];
    var i = 0;
    var jePrvni = true;
    do {
      var limit = jePrvni ? 75 : 74; // pokracovaci radek ma 1 oktet rezervovany na uvodni mezeru
      var bajty = 0;
      var kus = "";
      while (i < znaky.length) {
        var delka = icsDelkaZnaku(znaky[i]);
        if (bajty + delka > limit) break;
        kus += znaky[i];
        bajty += delka;
        i++;
      }
      kusy.push(kus);
      jePrvni = false;
    } while (i < znaky.length);

    var vysledek = kusy[0];
    for (var j = 1; j < kusy.length; j++) {
      vysledek += "\r\n " + kusy[j];
    }
    return vysledek;
  }

  function icsDtstamp(dt) {
    return (
      dt.getUTCFullYear() +
      dvojcislo(dt.getUTCMonth() + 1) +
      dvojcislo(dt.getUTCDate()) +
      "T" +
      dvojcislo(dt.getUTCHours()) +
      dvojcislo(dt.getUTCMinutes()) +
      dvojcislo(dt.getUTCSeconds()) +
      "Z"
    );
  }

  // Nazev projektu pro hlavicky (svolavka/ics) — prvni cast pred pomlckou
  // z nastaveni.nazev, napr. "Pragerovy kostky — Emauzy II" -> "Pragerovy kostky".
  function nazevProjektu(nastaveni) {
    var nazev = (nastaveni && nastaveni.nazev) || "Pragerovy kostky";
    return nazev.split(" — ")[0];
  }

  function najdiPodleId(pole, id) {
    if (!pole || !id) return null;
    for (var i = 0; i < pole.length; i++) {
      if (pole[i].id === id) return pole[i];
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Verejne API
  // ---------------------------------------------------------------------

  var Util = {};

  Util.esc = function (text) {
    if (text === null || text === undefined) return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  // presnost: "presne" | "mesic" | "obdobi" (u "obdobi" bere druhy datum jako iso2)
  Util.formatDatum = function (iso, presnost, iso2) {
    if (!iso) return "";
    var p = parsujIso(iso);
    if (presnost === "mesic") {
      return MESICE[p.mesic - 1] + " " + p.rok;
    }
    if (presnost === "obdobi") {
      var p2 = iso2 ? parsujIso(iso2) : p;
      var nazevOd = MESICE[p.mesic - 1];
      var nazevDo = MESICE[p2.mesic - 1];
      // Degenerovany pripad (obdobi splynulo do jednoho mesice) -> zobraz jen jeden mesic.
      if (p.rok === p2.rok && p.mesic === p2.mesic) {
        return nazevOd + " " + p.rok;
      }
      if (p.rok === p2.rok) {
        return nazevOd + "–" + nazevDo + " " + p2.rok;
      }
      return nazevOd + " " + p.rok + " – " + nazevDo + " " + p2.rok;
    }
    // "presne" a vychozi
    return p.den + ". " + p.mesic + ". " + p.rok;
  };

  // ------------------------------------------------------------------
  // Util.bezpecnyOdkaz(url) — vrati url jen kdyz je to http(s) odkaz,
  // jinak null. Chrani pred "javascript:" a "data:" v href u vsech poli,
  // ktera vyplnuji lide (MyAirBridge, Vimeo, odkazy v nastaveni projektu).
  // ------------------------------------------------------------------

  Util.bezpecnyOdkaz = function (url) {
    if (typeof url !== "string") return null;
    var ocisteny = url.trim();
    if (!ocisteny) return null;
    // Schema musi byt na zacatku a musi byt http nebo https. Porovnavame
    // v malych pismenech, at neprojde "JavaScript:" ani "jAvAsCrIpT:".
    var male = ocisteny.toLowerCase();
    if (male.indexOf("http://") === 0 || male.indexOf("https://") === 0) {
      return ocisteny;
    }
    return null;
  };

  Util.denVTydnu = function (iso) {
    var p = parsujIso(iso);
    var dt = new Date(Date.UTC(p.rok, p.mesic - 1, p.den));
    return DNY_V_TYDNU[dt.getUTCDay()];
  };

  Util.zaDni = function (iso) {
    var p = parsujIso(iso);
    var cil = new Date(p.rok, p.mesic - 1, p.den);
    var ted = new Date();
    var dnes = new Date(ted.getFullYear(), ted.getMonth(), ted.getDate());
    var rozdilMs = cil.getTime() - dnes.getTime();
    return Math.round(rozdilMs / 86400000);
  };

  Util.formatOdpocet = function (dni) {
    if (dni === 0) return "dnes";
    if (dni === 1) return "zítra";
    if (dni === -1) return "včera";
    if (dni > 0) return "za " + dni + " " + skloneniDnu(dni, "za");
    return "před " + Math.abs(dni) + " " + skloneniDnu(dni, "pred");
  };

  Util.formatCas = function (iso) {
    var dt = new Date(iso);
    var fmt = new Intl.DateTimeFormat("cs-CZ", {
      timeZone: "Europe/Prague",
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    var casti = fmt.formatToParts(dt);
    var mapa = {};
    casti.forEach(function (c) {
      mapa[c.type] = c.value;
    });
    return mapa.day + ". " + mapa.month + ". " + mapa.hour + ":" + mapa.minute;
  };

  Util.doSchranky = function (text) {
    function zaloha() {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-9999px";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch (e) {
        return false;
      }
    }

    return new Promise(function (resolve) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(text)
          .then(function () {
            resolve(true);
          })
          .catch(function () {
            resolve(zaloha());
          });
      } else {
        resolve(zaloha());
      }
    });
  };

  // Text svolavky PRESNE ve formatu KONTRAKT.md §10.1.
  // data = { lide: [...], plan: [...], nastaveni: {...} }
  Util.svolavka = function (navsteva, data) {
    data = data || {};
    var lide = data.lide || [];
    var plan = data.plan || [];

    function seznamOsob(ids) {
      if (!ids || !ids.length) return "—";
      var jmena = [];
      for (var i = 0; i < ids.length; i++) {
        var o = najdiPodleId(lide, ids[i]);
        if (!o) continue;
        jmena.push(o.telefon ? o.jmeno + " (" + o.telefon + ")" : o.jmeno);
      }
      return jmena.length ? jmena.join(", ") : "—";
    }

    var radky = [];
    radky.push(nazevProjektu(data.nastaveni) + " — natáčení č. " + navsteva.cislo);

    // Den v tydnu ma smysl jen u presneho data. U mesicnich a obdobnich
    // terminu by vzniklo nesmyslne "streda zari 2026" — a tenhle text jde
    // rovnou mailem koordinatorce a stavbyvedoucimu.
    var presnostTerminu = navsteva.datum_presnost || "presne";
    var terminRadek = "Termín: ";
    if (presnostTerminu === "presne") {
      terminRadek += Util.denVTydnu(navsteva.datum) + " ";
    }
    terminRadek += Util.formatDatum(navsteva.datum, presnostTerminu, navsteva.datum_do || null);
    if (presnostTerminu !== "presne") {
      terminRadek += " (orientačně, upřesníme předem)";
    }
    if (navsteva.cas_od && navsteva.cas_do) {
      terminRadek += ", " + navsteva.cas_od + "–" + navsteva.cas_do;
    }
    radky.push(terminRadek);

    if (navsteva.milnik_id) {
      var milnik = najdiPodleId(plan, navsteva.milnik_id);
      if (milnik) radky.push("Milník stavby: " + milnik.nazev);
    }

    radky.push("Co budeme točit:");
    var polozky = navsteva.co_se_toci || [];
    for (var k = 0; k < polozky.length; k++) {
      radky.push("  • " + polozky[k].text);
    }

    radky.push("Za stavbu: " + seznamOsob(navsteva.za_stavbu));
    radky.push("Za nás: " + seznamOsob(navsteva.za_nas));

    return radky.join("\n");
  };

  // ICS (VCALENDAR/VEVENT) string pro danou navstevu. data = { nastaveni: {...} }
  Util.ics = function (navsteva, data) {
    data = data || {};
    var nastaveni = data.nastaveni || {};
    var summary = nazevProjektu(nastaveni) + " — natáčení č. " + navsteva.cislo;
    var misto = nastaveni.misto || "";

    var popisRadky = [];
    var polozky = navsteva.co_se_toci || [];
    for (var i = 0; i < polozky.length; i++) {
      popisRadky.push("- " + polozky[i].text);
    }
    var popis = popisRadky.join("\n");

    var p = parsujIso(navsteva.datum);

    var radky = [];
    radky.push("BEGIN:VCALENDAR");
    radky.push("VERSION:2.0");
    radky.push("PRODID:-//Frantisek Dron//Kostky Kokpit//CS");
    radky.push("CALSCALE:GREGORIAN");
    radky.push("BEGIN:VTIMEZONE");
    radky.push("TZID:Europe/Prague");
    radky.push("BEGIN:DAYLIGHT");
    radky.push("TZOFFSETFROM:+0100");
    radky.push("TZOFFSETTO:+0200");
    radky.push("TZNAME:CEST");
    radky.push("DTSTART:19700329T020000");
    radky.push("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU");
    radky.push("END:DAYLIGHT");
    radky.push("BEGIN:STANDARD");
    radky.push("TZOFFSETFROM:+0200");
    radky.push("TZOFFSETTO:+0100");
    radky.push("TZNAME:CET");
    radky.push("DTSTART:19701025T030000");
    radky.push("RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU");
    radky.push("END:STANDARD");
    radky.push("END:VTIMEZONE");
    radky.push("BEGIN:VEVENT");

    radky.push("UID:" + navsteva.id + "@kostky-kokpit.frantisekdron.cz");
    radky.push("DTSTAMP:" + icsDtstamp(new Date()));

    if (navsteva.cas_od && navsteva.cas_do) {
      var codOd = navsteva.cas_od.split(":");
      var codDo = navsteva.cas_do.split(":");
      var datumCast = p.rok + dvojcislo(p.mesic) + dvojcislo(p.den);
      var dtStart =
        datumCast + "T" + dvojcislo(parseInt(codOd[0], 10)) + dvojcislo(parseInt(codOd[1], 10)) + "00";
      var dtEnd =
        datumCast + "T" + dvojcislo(parseInt(codDo[0], 10)) + dvojcislo(parseInt(codDo[1], 10)) + "00";
      radky.push("DTSTART;TZID=Europe/Prague:" + dtStart);
      radky.push("DTEND;TZID=Europe/Prague:" + dtEnd);
    } else {
      // Celodenni udalost — DTEND je vylucny (nasledujici den), dle RFC 5545.
      var datumOd = p.rok + dvojcislo(p.mesic) + dvojcislo(p.den);
      var nasledujici = new Date(p.rok, p.mesic - 1, p.den + 1);
      var datumDo =
        nasledujici.getFullYear() +
        dvojcislo(nasledujici.getMonth() + 1) +
        dvojcislo(nasledujici.getDate());
      radky.push("DTSTART;VALUE=DATE:" + datumOd);
      radky.push("DTEND;VALUE=DATE:" + datumDo);
    }

    radky.push(zalomRadek("SUMMARY:" + icsText(summary)));
    if (misto) radky.push(zalomRadek("LOCATION:" + icsText(misto)));
    if (popis) radky.push(zalomRadek("DESCRIPTION:" + icsText(popis)));

    radky.push("END:VEVENT");
    radky.push("END:VCALENDAR");

    return radky.join("\r\n");
  };

  Util.stahni = function (nazevSouboru, obsah, mime) {
    var blob = new Blob([obsah], { type: mime || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var odkaz = document.createElement("a");
    odkaz.href = url;
    odkaz.download = nazevSouboru;
    document.body.appendChild(odkaz);
    odkaz.click();
    document.body.removeChild(odkaz);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  };

  // Vychod/zapad/zlata hodina — cista matematika (NOAA algoritmus), zadne API.
  // Vysledek je v mistnim case Europe/Prague (rucne resene letni/zimni cas).
  Util.slunce = function (datumIso, lat, lon) {
    var p = parsujIso(datumIso);
    var jd = julianskyDen(p.rok, p.mesic, p.den);
    var vysledek = vypoctiSlunce(jd, lat, lon);
    var letni = jeLetniCas(p.rok, p.mesic, p.den);
    var offsetMin = (letni ? 2 : 1) * 60;

    function minutyNaCas(minutyUtc) {
      var m = minutyUtc + offsetMin;
      m = ((m % 1440) + 1440) % 1440;
      var h = Math.floor(m / 60);
      var min = Math.round(m % 60);
      if (min === 60) {
        min = 0;
        h = (h + 1) % 24;
      }
      return dvojcislo(h) + ":" + dvojcislo(min);
    }

    var zapadCas = minutyNaCas(vysledek.zapad);
    return {
      vychod: minutyNaCas(vysledek.vychod),
      zapad: zapadCas,
      zlataOd: minutyNaCas(vysledek.zapad - 60),
      zlataDo: zapadCas
    };
  };

  Util.velikostNaGb = function (text) {
    if (!text || typeof text !== "string") return null;
    var m = text.trim().match(/^([0-9]+(?:[.,][0-9]+)?)\s*(GB|MB|TB)$/i);
    if (!m) return null;
    var cislo = parseFloat(m[1].replace(",", "."));
    if (isNaN(cislo)) return null;
    var jednotka = m[2].toUpperCase();
    if (jednotka === "GB") return cislo;
    if (jednotka === "MB") return cislo / 1024;
    if (jednotka === "TB") return cislo * 1024;
    return null;
  };

  return Util;
})();
