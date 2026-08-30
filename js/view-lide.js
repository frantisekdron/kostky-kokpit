/*
 * view-lide.js — sekce "Tým" (KONTRAKT.md §9.5 „Lidé", datový model §3.3).
 * Sekce se od 30. 8. 2026 jmenuje Tým; klíč dat i soubor zůstaly „lide".
 *
 * Vykresluje kontakty zapojené do projektu ve třech skupinách podle strany
 * (PORR / Metrostav / FD — náš tým), barevně odlišených. Karta obsahuje
 * jméno, funkci, roli v projektu, telefon (tel:), e-mail (mailto:), poznámku
 * a štítek "má přístup do kokpitu: <role>" u lidí s vyplněným ma_pristup.
 * Přidání / editace / soft delete osoby jen pro právo `lide.upravit`.
 *
 * Čte App.polozky('lide') a App.obsah('pristupy') ({role, uzivatele}) —
 * App.data drží VŽDY celou obálku souboru, proto se nikdy nesahá na
 * App.data[soubor] přímo (viz hlavičkový komentář js/app.js). Zapisuje přes
 * GH.zmen('lide', ...) a po úspěchu uloží celou vrácenou obálku pomocí
 * App.uloz('lide', obsah). Používá App.modal / App.potvrd / App.toast /
 * App.prekresli / App.jmenoOsoby přesně podle API v js/app.js.
 *
 * Nevystavuje žádný nový globální objekt — jen se při načtení stránky
 * zaregistruje jako sekce "lide" přes App.registrujSekci().
 */

(function () {
  "use strict";

  var esc = Util.esc;
  var SOUBOR = "lide";

  var STRANY = [
    { kod: "PORR", nazev: "PORR", trida: "strana-porr" },
    { kod: "Metrostav", nazev: "Metrostav", trida: "strana-metrostav" },
    { kod: "FD", nazev: "František Dron (náš tým)", trida: "strana-fd" }
  ];

  // ---- tenké obaly nad společnými App.polozky()/App.obsah() (js/app.js) ----

  function polozkyLidi() {
    return App.polozky("lide");
  }

  function objektPristupu() {
    return App.obsah("pristupy");
  }

  function seznamKonfigOsob() {
    return window.KONFIG && Array.isArray(KONFIG.osoby) ? KONFIG.osoby : [];
  }

  function popisPristupu(idKonfigOsoby) {
    var pr = objektPristupu();
    var uziv = pr.uzivatele && pr.uzivatele[idKonfigOsoby];
    if (!uziv) return { text: idKonfigOsoby, aktivni: true };
    var roleZaznam = pr.role && pr.role[uziv.role];
    var nazevRole = roleZaznam && roleZaznam.nazev ? roleZaznam.nazev : uziv.role;
    return { text: nazevRole, aktivni: uziv.aktivni !== false };
  }

  // ---- vykreslení ----

  function vykresli(kontejnerParam) {
    var kontejner = kontejnerParam || document.getElementById("obsah");
    if (!kontejner) return;

    var lide = polozkyLidi().filter(function (o) { return !o.smazano; });
    var smiUpravovat = Auth.can("lide.upravit");

    var html = '<div class="sekce-hlava"><h2>Tým</h2>';
    if (smiUpravovat) {
      html += '<button type="button" class="btn btn-primarni" data-akce="pridat">+ Přidat osobu</button>';
    }
    html += "</div>";

    STRANY.forEach(function (strana) {
      var skupina = lide.filter(function (o) { return o.strana === strana.kod; });
      html += '<section class="skupina-lidi ' + strana.trida + '">';
      html += '<h3 class="skupina-nadpis">' + esc(strana.nazev) + "</h3>";
      if (!skupina.length) {
        html += '<p class="prazdny-stav-mini">Zatím tu nikdo není.</p>';
      } else {
        html += '<div class="karty-mrizka">' + skupina.map(function (o) { return kartaOsoby(o, smiUpravovat, strana.trida); }).join("") + "</div>";
      }
      html += "</section>";
    });

    kontejner.innerHTML = html;
    napojPosluchace(kontejner);
  }

  function kartaOsoby(o, smiUpravovat, tridaStrany) {
    var telefon = String(o.telefon || "").trim();
    var email = String(o.email || "").trim();

    var kontakty = "";
    if (telefon) {
      kontakty += '<a class="kontakt-radek" href="tel:' + esc(telefon.replace(/\s+/g, "")) + '">' + esc(telefon) + "</a>";
    }
    if (email) {
      kontakty += '<a class="kontakt-radek" href="mailto:' + esc(email) + '">' + esc(email) + "</a>";
    }

    var stitekPristup = "";
    if (o.ma_pristup) {
      var p = popisPristupu(o.ma_pristup);
      stitekPristup =
        '<span class="stitek stitek-role">' +
        "má přístup do kokpitu: " + esc(p.text) + (p.aktivni ? "" : " (pozastaveno)") +
        "</span>";
    }

    var akce = "";
    if (smiUpravovat) {
      akce =
        '<span class="karta-akce">' +
        '<button type="button" class="btn btn-mala btn-sekundarni" data-akce="upravit" data-id="' + esc(o.id) + '" title="Upravit osobu">Upravit</button>' +
        '<button type="button" class="btn btn-mala btn-nebezpecny" data-akce="smazat" data-id="' + esc(o.id) + '" title="Přesunout do koše">Smazat</button>' +
        "</span>";
    }

    // trida strany (strana-porr/strana-metrostav/strana-fd) jde přímo na .karta,
    // ať CSS proměnná --stav-barva obarví levou linku (viz styles.css u .karta.strana-*).
    return (
      '<article class="karta karta-osoba ' + tridaStrany + '" data-id="' + esc(o.id) + '">' +
      '<div class="karta-hlavicka">' +
      '<strong class="karta-nadpis">' + esc(o.jmeno) + "</strong>" +
      akce +
      "</div>" +
      (o.funkce ? '<div class="karta-meta">' + esc(o.funkce) + "</div>" : "") +
      (o.role_v_projektu ? '<div class="karta-radek"><span class="karta-label">Role v projektu:</span> ' + esc(o.role_v_projektu) + "</div>" : "") +
      (kontakty ? '<div class="karta-kontakty">' + kontakty + "</div>" : "") +
      stitekPristup +
      (o.poznamka ? '<p class="karta-popis">' + esc(o.poznamka) + "</p>" : "") +
      "</article>"
    );
  }

  // ---- posluchač: delegace na kontejneru #obsah. Ten je sdílený mezi VŠEMI
  // sekcemi a app.js ho při každém přepnutí sekce vyprázdní (removeChild),
  // ale sám element nikdy nenahrazuje — proto se posluchač věší jen jednou
  // (kontejner._lideNapojeno) a při každém kliku se ověří, že kontejner
  // pořád patří téhle sekci (dataset.aktivniSekce), jinak se klik ignoruje. ----

  function napojPosluchace(kontejner) {
    kontejner.dataset.aktivniSekce = "lide";
    if (kontejner._lideNapojeno) return;
    kontejner._lideNapojeno = true;
    kontejner.addEventListener("click", function (e) {
      if (kontejner.dataset.aktivniSekce !== "lide") return;
      var btn = e.target.closest("[data-akce]");
      if (!btn) return;
      var akce = btn.dataset.akce;
      if (akce === "pridat") otevriFormular(null);
      else if (akce === "upravit") otevriFormular(btn.dataset.id);
      else if (akce === "smazat") smazatOsobu(btn.dataset.id);
    });
  }

  // ---- formulář přidání / editace (App.modal({nadpis, obsah})) ----

  function moznostiPristupu(vybranyId) {
    return seznamKonfigOsob()
      .map(function (o) {
        return '<option value="' + esc(o.id) + '"' + (o.id === vybranyId ? " selected" : "") + ">" + esc(o.jmeno || o.id) + "</option>";
      })
      .join("");
  }

  function otevriFormular(id) {
    var jeNovy = !id;
    var osoba = jeNovy ? null : polozkyLidi().find(function (o) { return o.id === id; });
    if (!jeNovy && !osoba) return;

    var form = document.createElement("form");
    form.className = "formular formular-osoba";
    form.innerHTML =
      '<div class="pole"><label for="f-lide-jmeno">Jméno *</label>' +
      '<input id="f-lide-jmeno" name="jmeno" type="text" required value="' + esc(osoba ? osoba.jmeno : "") + '"></div>' +
      '<div class="pole"><label for="f-lide-strana">Strana *</label>' +
      '<select id="f-lide-strana" name="strana" required>' +
      STRANY.map(function (s) {
        return '<option value="' + esc(s.kod) + '"' + (osoba && osoba.strana === s.kod ? " selected" : "") + ">" + esc(s.nazev) + "</option>";
      }).join("") +
      "</select></div>" +
      '<div class="pole"><label for="f-lide-funkce">Funkce</label>' +
      '<input id="f-lide-funkce" name="funkce" type="text" value="' + esc(osoba ? osoba.funkce || "" : "") + '"></div>' +
      '<div class="pole"><label for="f-lide-role">Role v projektu</label>' +
      '<input id="f-lide-role" name="role_v_projektu" type="text" value="' + esc(osoba ? osoba.role_v_projektu || "" : "") + '"></div>' +
      '<div class="pole"><label for="f-lide-telefon">Telefon</label>' +
      '<input id="f-lide-telefon" name="telefon" type="tel" value="' + esc(osoba ? osoba.telefon || "" : "") + '"></div>' +
      '<div class="pole"><label for="f-lide-email">E-mail</label>' +
      '<input id="f-lide-email" name="email" type="email" value="' + esc(osoba ? osoba.email || "" : "") + '"></div>' +
      '<div class="pole"><label for="f-lide-pristup">Přístup do kokpitu</label>' +
      '<select id="f-lide-pristup" name="ma_pristup"><option value="">— jen kontakt, bez přístupu —</option>' +
      moznostiPristupu(osoba ? osoba.ma_pristup : null) +
      "</select></div>" +
      '<div class="pole"><label for="f-lide-poznamka">Poznámka</label>' +
      '<textarea id="f-lide-poznamka" name="poznamka" rows="3">' + esc(osoba ? osoba.poznamka || "" : "") + "</textarea></div>" +
      '<div class="formular-akce">' +
      '<button type="submit" class="btn btn-primarni">' + (jeNovy ? "Přidat osobu" : "Uložit změny") + "</button>" +
      '<button type="button" class="btn btn-sekundarni btn-zrusit">Zrušit</button>' +
      "</div>";

    var handle = App.modal({ nadpis: jeNovy ? "Přidat osobu" : "Upravit osobu: " + osoba.jmeno, obsah: form });

    form.querySelector(".btn-zrusit").addEventListener("click", function () {
      handle.zavri();
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var data = nacistFormular(form);
      if (!data) return;
      var tlacitko = form.querySelector('button[type="submit"]');
      tlacitko.disabled = true;
      ulozitOsobu(jeNovy, osoba, data).then(function (ok) {
        tlacitko.disabled = false;
        if (ok) handle.zavri();
      });
    });

    var prvniPole = form.querySelector("#f-lide-jmeno");
    if (prvniPole) prvniPole.focus();
  }

  function nacistFormular(form) {
    var jmeno = form.elements["jmeno"].value.trim();
    var strana = form.elements["strana"].value;
    if (!jmeno) {
      App.toast("Vyplň jméno osoby.", "chyba");
      return null;
    }
    if (!STRANY.some(function (s) { return s.kod === strana; })) {
      App.toast("Vyber platnou stranu.", "chyba");
      return null;
    }
    return {
      jmeno: jmeno,
      strana: strana,
      funkce: form.elements["funkce"].value.trim(),
      telefon: form.elements["telefon"].value.trim(),
      email: form.elements["email"].value.trim(),
      role_v_projektu: form.elements["role_v_projektu"].value.trim(),
      ma_pristup: form.elements["ma_pristup"].value.trim() || null,
      poznamka: form.elements["poznamka"].value.trim()
    };
  }

  function ulozitOsobu(jeNovy, osoba, data) {
    return GH.zmen(
      SOUBOR,
      function (polozky) {
        if (jeNovy) {
          Object.assign(data, { id: GH.noveId("os"), smazano: null });
          polozky.push(data);
        } else {
          var existujici = polozky.find(function (o) { return o.id === osoba.id; });
          if (!existujici) throw new Error("Osoba nenalezena.");
          Object.assign(existujici, data);
        }
      },
      (jeNovy ? "Přidána osoba — " : "Upravena osoba — ") + data.jmeno
    )
      .then(function (obsah) {
        App.uloz("lide", obsah);
        App.toast(jeNovy ? "Osoba přidána." : "Osoba upravena.", "ok");
        App.prekresli();
        return true;
      })
      .catch(function (chyba) {
        App.toast((chyba && chyba.hlaska) || "Uložení se nepovedlo.", "chyba");
        return false;
      });
  }

  function smazatOsobu(id) {
    var osoba = polozkyLidi().find(function (o) { return o.id === id; });
    if (!osoba) return;

    App.potvrd('Opravdu přesunout osobu „' + osoba.jmeno + '“ do koše?').then(function (ano) {
      if (!ano) return;
      GH.zmen(
        SOUBOR,
        function (polozky) {
          var p = polozky.find(function (o) { return o.id === id; });
          if (p) p.smazano = { kdy: new Date().toISOString(), kdo: (Auth.ja && Auth.ja.osoba_id) || null };
        },
        "Smazána osoba — " + osoba.jmeno
      )
        .then(function (obsah) {
          App.uloz("lide", obsah);
          App.toast("Osoba přesunuta do koše.", "ok");
          App.prekresli();
        })
        .catch(function (chyba) {
          App.toast((chyba && chyba.hlaska) || "Smazání se nepovedlo.", "chyba");
        });
    });
  }

  App.registrujSekci("lide", vykresli);
})();
