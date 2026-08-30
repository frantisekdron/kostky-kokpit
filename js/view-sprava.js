/*
 * view-sprava.js — sekce "Správa" (KONTRAKT.md §9.7), jen pro `prava.upravit`.
 *
 * Tři bloky:
 *   1) Matice práv — tabulka role × právo se zaškrtávátky, sloupec superadmina
 *      zamčený. "Uložit matici" (jeden commit) a "Vrátit na výchozí" (potvrzení).
 *   2) Uživatelé — seznam z KONFIG.osoby, u každého role + přepínač aktivní.
 *      Nejde deaktivovat sám sebe ani si sundat roli superadmina jako poslední
 *      superadmin. Vedle organizační role stojí sloupec "Úroveň tokenu"
 *      (Auth.roleZTokenu) — u přihlášeného člověka je vidět skutečná
 *      kryptografická úroveň jeho tokenu a případný nesoulad s rolí
 *      z pristupy.json (§1.1 kontraktu + ZMENA_LIDE.md bod 2). U ostatních
 *      osob ji z prohlížeče zjistit nelze (jejich blob v config.js je
 *      zašifrovaný jejich heslem), proto se tam píše "nezjistitelná".
 *   3) Nastavení projektu — editace nastaveni.json (název, podnázev, investor,
 *      zhotovitel, místo, datumy, rozsah, odkazy — přidat/odebrat).
 *
 * Čte App.obsah('pristupy') ({role, uzivatele}) a App.obsah('nastaveni')
 * (plochý objekt) — App.data drží VŽDY celou obálku souboru, proto se nikdy
 * nesahá na App.data[soubor] přímo (viz hlavičkový komentář js/app.js).
 * Zapisuje přes GH.zmen('pristupy', ...) a GH.zmen('nastaveni', ...) a po
 * úspěchu uloží celou vrácenou obálku pomocí App.uloz(soubor, obsah).
 * Používá App.potvrd / App.toast / App.prekresli podle API v js/app.js.
 * Tři bloky se překreslují NEZÁVISLE (viz prekresliMatici/
 * prekresliUzivatele/prekresliNastaveni) — ne přes App.prekresli(), aby akce
 * v jednom bloku (např. přepnutí role uživatele) nesmazala rozepsaný, ještě
 * neuložený formulář v jiném bloku (Nastavení projektu).
 *
 * Nevystavuje žádný nový globální objekt — jen se při načtení stránky
 * zaregistruje jako sekce "sprava" přes App.registrujSekci().
 */

(function () {
  "use strict";

  var esc = Util.esc;

  // Seznam práv PŘESNĚ podle §5 kontraktu + `casosber.upravit` z KONTRAKT_DODATEK.md
  // (bod A.7 explicitně žádá doplnit toto právo do matice ve view-sprava.js).
  var PRAVA_SEZNAM = [
    { kod: "cist", popis: "vidět dashboard (má každá role)" },
    { kod: "navstevy.pridat", popis: "přidat návštěvu" },
    { kod: "navstevy.upravit", popis: "upravit návštěvu" },
    { kod: "navstevy.smazat", popis: "poslat návštěvu do koše" },
    { kod: "navstevy.schvalit", popis: "schválit / vrátit návrh (schvalovací kolečko)" },
    { kod: "plan.upravit", popis: "přidat / upravit / smazat milník stavby" },
    { kod: "materialy.pridat", popis: "přidat materiál" },
    { kod: "materialy.upravit", popis: "upravit materiál (vč. odkazů)" },
    { kod: "materialy.smazat", popis: "poslat materiál do koše" },
    { kod: "lide.upravit", popis: "přidat / upravit / smazat osobu" },
    { kod: "komentare.pridat", popis: "psát komentáře" },
    { kod: "komentare.smazat.cizi", popis: "mazat cizí komentáře" },
    { kod: "kos.obnovit", popis: "vracet věci z koše" },
    { kod: "kos.vysypat", popis: "trvale mazat" },
    { kod: "nastaveni.upravit", popis: "měnit nastavení projektu" },
    { kod: "prava.upravit", popis: "měnit matici práv a role uživatelů" },
    { kod: "casosber.upravit", popis: "přidat / upravit / smazat místo pro kameru a nahrát k němu fotku" },
    { kod: "pripominky.pridat", popis: "napsat připomínku" },
    { kod: "pripominky.resit", popis: "měnit stav připomínky a odpovídat na ni" }
  ];

  var ROLE_PORADI = ["superadmin", "admin", "editor", "ctenar"];
  var ROLE_VYCHOZI_NAZVY = { superadmin: "Super admin", admin: "Admin", editor: "Editor", ctenar: "Čtenář" };

  // Výchozí matice PŘESNĚ podle §5 kontraktu (casosber.upravit dle dodatku A.7:
  // superadmin/admin/editor ano, čtenář ne).
  var VYCHOZI_MATICE = {
    superadmin: {
      "cist": true, "navstevy.pridat": true, "navstevy.upravit": true, "navstevy.smazat": true,
      "navstevy.schvalit": true, "plan.upravit": true, "materialy.pridat": true, "materialy.upravit": true,
      "materialy.smazat": true, "lide.upravit": true, "komentare.pridat": true, "komentare.smazat.cizi": true,
      "kos.obnovit": true, "kos.vysypat": true, "nastaveni.upravit": true, "prava.upravit": true,
      "casosber.upravit": true, "pripominky.pridat": true, "pripominky.resit": true
    },
    admin: {
      "cist": true, "navstevy.pridat": true, "navstevy.upravit": true, "navstevy.smazat": true,
      "navstevy.schvalit": true, "plan.upravit": true, "materialy.pridat": true, "materialy.upravit": true,
      "materialy.smazat": true, "lide.upravit": true, "komentare.pridat": true, "komentare.smazat.cizi": true,
      "kos.obnovit": true, "kos.vysypat": false, "nastaveni.upravit": true, "prava.upravit": false,
      "casosber.upravit": true, "pripominky.pridat": true, "pripominky.resit": false
    },
    editor: {
      "cist": true, "navstevy.pridat": true, "navstevy.upravit": true, "navstevy.smazat": false,
      "navstevy.schvalit": false, "plan.upravit": true, "materialy.pridat": true, "materialy.upravit": true,
      "materialy.smazat": false, "lide.upravit": false, "komentare.pridat": true, "komentare.smazat.cizi": false,
      "kos.obnovit": false, "kos.vysypat": false, "nastaveni.upravit": false, "prava.upravit": false,
      "casosber.upravit": true, "pripominky.pridat": true, "pripominky.resit": false
    },
    ctenar: {
      "cist": true, "navstevy.pridat": false, "navstevy.upravit": false, "navstevy.smazat": false,
      "navstevy.schvalit": false, "plan.upravit": false, "materialy.pridat": false, "materialy.upravit": false,
      "materialy.smazat": false, "lide.upravit": false, "komentare.pridat": false, "komentare.smazat.cizi": false,
      "kos.obnovit": false, "kos.vysypat": false, "nastaveni.upravit": false, "prava.upravit": false,
      "casosber.upravit": false, "pripominky.pridat": false, "pripominky.resit": false
    }
  };

  var posledniKontejner = null;
  var stagingMatice = null; // pracovní kopie prav do dalšího uložení
  var stagingMaticeVerze = null; // verze pristupy.json, ze které staging vznikl
  var stagingNastaveni = null; // pracovní kopie formuláře nastavení do dalšího uložení

  // ---- tenké obaly nad společnými App.obsah()/App.uloz() (js/app.js).
  // dataPristupu() vždy vrátí oba klíče (role/uzivatele) jako objekty, ať
  // se s nimi níže dá bez dalších kontrol pracovat (role[rk], uzivatele[id]). ----

  function dataPristupu() {
    var d = App.obsah("pristupy");
    return { role: d.role || {}, uzivatele: d.uzivatele || {} };
  }

  function dataNastaveni() {
    return App.obsah("nastaveni");
  }

  // Verze obálky pristupy.json — podle ní se pozná, že data mezitím dorazila
  // z GitHubu (první načtení nebo polling) a pracovní kopie matice je stará.
  // Bez toho by matice vykreslená ještě před načtením dat zůstala na
  // výchozích hodnotách napořád (nález auditu O1-sjednoceni-appdata).
  function verzePristupu() {
    var obal = App.data && App.data.pristupy;
    return obal && typeof obal.verze !== "undefined" ? obal.verze : null;
  }

  function zajistiStagingMatice() {
    if (!stagingMatice || stagingMaticeVerze !== verzePristupu()) {
      stagingMatice = pripravStagingMatice(dataPristupu().role);
      stagingMaticeVerze = verzePristupu();
    }
    return stagingMatice;
  }

  // GH.zmen('pristupy'/'nastaveni', ...) vrací CELOU obálku {verze,...,data:{...}} —
  // App.data drží tuto obálku beze změny (App.uloz), App.obsah() z ní pak čte
  // vnitřní .data.
  function ulozPristupy(obsah) {
    App.uloz("pristupy", obsah);
  }

  function ulozNastaveni(obsah) {
    App.uloz("nastaveni", obsah);
  }

  function seznamKonfigOsob() {
    if (window.KONFIG && Array.isArray(KONFIG.osoby)) return KONFIG.osoby;
    // Demo rezim nema config.js (a tedy ani KONFIG) — seznam osob sestavime
    // z dat, at jde sprava roli a prepinac "aktivni" proklikat nanecisto.
    // Je to prave ta vec ze zadani, kterou si ma clovek v demu prohlednout.
    if (window.DEMO === true) {
      return App.polozky("lide")
        .filter(function (o) { return !o.smazano && o.ma_pristup; })
        .map(function (o) { return { id: o.ma_pristup, jmeno: o.jmeno }; });
    }
    return [];
  }

  // ---- hlavní vykreslení ----

  function vykresli(kontejnerParam) {
    var kontejner = kontejnerParam || document.getElementById("obsah");
    if (!kontejner) return;

    if (!Auth.can("prava.upravit")) {
      kontejner.dataset.aktivniSekce = "sprava";
      kontejner.innerHTML =
        '<div class="sekce-hlava"><h2>Správa</h2></div>' +
        '<p class="prazdny-stav">Tahle sekce je jen pro lidi s právem měnit přístupy.</p>';
      return;
    }

    posledniKontejner = kontejner;

    zajistiStagingMatice();

    kontejner.innerHTML =
      '<div class="sekce-hlava"><h2>Správa</h2></div>' +
      '<div id="blok-matice"></div>' +
      '<div id="blok-uzivatele"></div>' +
      '<div id="blok-nastaveni"></div>';

    prekresliMatici();
    prekresliUzivatele();
    prekresliNastaveni();
    napojPosluchace(kontejner);
  }

  // =========================================================
  // 1) Matice práv
  // =========================================================

  function pripravStagingMatice(role) {
    var staging = {};
    ROLE_PORADI.forEach(function (rk) {
      staging[rk] = {};
      var zdroj = (role && role[rk] && role[rk].prava) || {};
      PRAVA_SEZNAM.forEach(function (pr) {
        if (rk === "superadmin") {
          staging[rk][pr.kod] = true;
        } else if (typeof zdroj[pr.kod] === "boolean") {
          staging[rk][pr.kod] = zdroj[pr.kod];
        } else {
          staging[rk][pr.kod] = !!(VYCHOZI_MATICE[rk] && VYCHOZI_MATICE[rk][pr.kod]);
        }
      });
    });
    return staging;
  }

  function nazevRole(role, rk) {
    return (role && role[rk] && role[rk].nazev) || ROLE_VYCHOZI_NAZVY[rk];
  }

  function vykresliMatici() {
    var role = dataPristupu().role;
    var staging = zajistiStagingMatice();
    var html = '<section class="blok-spravy"><h3>Matice práv</h3>';
    html += '<div class="tabulka-wrap"><table class="tabulka-prav"><thead><tr><th>Právo</th>';
    ROLE_PORADI.forEach(function (rk) {
      var popisRole = role && role[rk] && role[rk].popis;
      html += "<th" + (popisRole ? ' title="' + esc(popisRole) + '"' : "") + ">" + esc(nazevRole(role, rk)) + "</th>";
    });
    html += "</tr></thead><tbody>";
    PRAVA_SEZNAM.forEach(function (pr) {
      html += '<tr><td><span class="pravo-kod">' + esc(pr.kod) + '</span><span class="pravo-popis">' + esc(pr.popis) + "</span></td>";
      ROLE_PORADI.forEach(function (rk) {
        var zamceno = rk === "superadmin";
        var zaskrtnuto = staging[rk][pr.kod];
        html +=
          '<td class="bunka-checkbox"><input type="checkbox" data-role="' + esc(rk) + '" data-pravo="' + esc(pr.kod) + '"' +
          (zaskrtnuto ? " checked" : "") + (zamceno ? " disabled" : "") +
          ' aria-label="' + esc(nazevRole(role, rk) + " — " + pr.kod) + '"></td>';
      });
      html += "</tr>";
    });
    html += "</tbody></table></div>";
    html +=
      '<div class="formular-akce">' +
      '<button type="button" class="btn btn-sekundarni" data-akce="vratit-vychozi">Vrátit na výchozí</button>' +
      '<button type="button" class="btn btn-primarni" data-akce="ulozit-matici">Uložit matici</button>' +
      "</div></section>";
    return html;
  }

  function prekresliMatici() {
    var el = posledniKontejner && posledniKontejner.querySelector("#blok-matice");
    if (!el) return;
    el.innerHTML = vykresliMatici();
  }

  function ulozitMatici() {
    var kopie = JSON.parse(JSON.stringify(zajistiStagingMatice()));
    PRAVA_SEZNAM.forEach(function (pr) { kopie.superadmin[pr.kod] = true; }); // pojistka

    GH.zmen(
      "pristupy",
      function (data) {
        data.role = data.role || {};
        ROLE_PORADI.forEach(function (rk) {
          data.role[rk] = data.role[rk] || { nazev: ROLE_VYCHOZI_NAZVY[rk], popis: "", prava: {} };
          // SLUČUJEME, nepřepisujeme celý objekt. Kdyby v souboru bylo právo,
          // které tahle verze appky ještě nezná (novější sekce, jiný stroj),
          // přepsáním celého objektu by se tiše smazalo.
          data.role[rk].prava = data.role[rk].prava || {};
          Object.keys(kopie[rk]).forEach(function (kod) {
            data.role[rk].prava[kod] = kopie[rk][kod];
          });
        });
      },
      "Upravena matice práv"
    )
      .then(function (obsah) {
        ulozPristupy(obsah);
        stagingMatice = null; // vynutí přestavění z právě uložených dat
        zajistiStagingMatice();
        App.toast("Matice práv uložena.", "ok");
        prekresliMatici();
      })
      .catch(function (chyba) {
        App.toast((chyba && chyba.hlaska) || "Uložení matice se nepovedlo.", "chyba");
      });
  }

  function vratitNaVychozi() {
    App.potvrd("Opravdu vrátit matici práv na výchozí nastavení? Přepíše to všechna aktuální oprávnění rolí (superadmin má vždy vše).").then(function (ano) {
      if (!ano) return;
      GH.zmen(
        "pristupy",
        function (data) {
          data.role = data.role || {};
          ROLE_PORADI.forEach(function (rk) {
            data.role[rk] = data.role[rk] || { nazev: ROLE_VYCHOZI_NAZVY[rk], popis: "", prava: {} };
            data.role[rk].prava = JSON.parse(JSON.stringify(VYCHOZI_MATICE[rk]));
          });
        },
        "Matice práv vrácena na výchozí nastavení"
      )
        .then(function (obsah) {
          ulozPristupy(obsah);
          stagingMatice = null; // vynutí přestavění z právě uložených dat
          zajistiStagingMatice();
          App.toast("Matice práv vrácena na výchozí.", "ok");
          prekresliMatici();
        })
        .catch(function (chyba) {
          App.toast((chyba && chyba.hlaska) || "Vrácení na výchozí se nepovedlo.", "chyba");
        });
    });
  }

  // =========================================================
  // 2) Uživatelé
  // =========================================================

  function pocetAktivnichSuperadminu(pristupy) {
    return seznamKonfigOsob().filter(function (o) {
      var u = pristupy.uzivatele && pristupy.uzivatele[o.id];
      return !!(u && u.role === "superadmin" && u.aktivni !== false);
    }).length;
  }

  function jmenoKonfigOsoby(id) {
    var o = seznamKonfigOsob().find(function (x) { return x.id === id; });
    return (o && o.jmeno) || id;
  }

  // Skutečná kryptografická úroveň tokenu (§1.1 kontraktu): auth.js ji zamkne
  // při přihlášení do Auth.roleZTokenu a už ji po zbytek session nemění.
  // Zjistitelná je JEN u právě přihlášeného člověka — bloby ostatních osob
  // v config.js jsou zašifrované jejich vlastními hesly, z prohlížeče se
  // otevřít nedají. Vrací:
  //   { znama, text, varovani: null | {stitek, popis} }
  // Obě strany nesouladu mezi organizační rolí (pristupy.json) a fyzickou
  // úrovní tokenu jsou vidět, protože každá se řeší jinak (§1.1 kontraktu
  // + ZMENA_LIDE.md bod 2).
  function urovenTokenu(idOsoby, roleZPristupu) {
    var jaSam = !!(window.Auth && Auth.ja && Auth.ja.id === idOsoby);
    var kod = jaSam && window.Auth ? Auth.roleZTokenu : null;
    if (!kod) {
      return { znama: false, text: "nezjistitelná", varovani: null };
    }

    var tokenPise = kod !== "ctenar";
    var rolePise = roleZPristupu !== "ctenar";
    var text = (ROLE_VYCHOZI_NAZVY[kod] || kod) + (tokenPise ? " — token se zápisem" : " — token jen ke čtení");

    var varovani = null;
    if (!tokenPise && rolePise) {
      varovani = {
        stitek: "role bez tokenu",
        popis:
          "Role z pristupy.json slibuje zápis, ale token je jen ke čtení — každý zápis spadne na 403. " +
          "Povýšení vyžaduje scripts/nastav_pristup.py --pridej a nové nasazení."
      };
    } else if (tokenPise && !rolePise) {
      varovani = {
        stitek: "token pořád píše",
        popis:
          "Role je jen ke čtení, ale token fyzicky zapisovat umí. Je to organizační opatření, ne kryptografické — " +
          "skutečné odebrání vyžaduje scripts/nastav_pristup.py --rotace a nové nasazení."
      };
    }
    return { znama: true, text: text, varovani: varovani };
  }

  function vykresliUzivatele() {
    var pristupy = dataPristupu();
    var seznam = seznamKonfigOsob();
    var pocetSuperadminu = pocetAktivnichSuperadminu(pristupy);

    var html = '<section class="blok-spravy"><h3>Uživatelé</h3>';
    if (!seznam.length) {
      html += '<p class="prazdny-stav-mini">V config.js zatím nejsou žádné osoby.</p>';
    } else {
      html += '<div class="tabulka-wrap"><table class="tabulka-uzivatele"><thead><tr><th>Jméno</th>' +
        "<th>Role (organizační)</th>" +
        '<th title="Skutečná kryptografická úroveň tokenu — zjistitelná jen u právě přihlášeného člověka.">Úroveň tokenu</th>' +
        "<th>Aktivní</th></tr></thead><tbody>";
      seznam.forEach(function (o) {
        var u = (pristupy.uzivatele && pristupy.uzivatele[o.id]) || { role: "ctenar", aktivni: true };
        var jaSam = !!(Auth.ja && Auth.ja.id === o.id);
        var jePosledniSuperadmin = u.role === "superadmin" && pocetSuperadminu <= 1;

        html += '<tr data-uzivatel="' + esc(o.id) + '">';
        html += "<td>" + esc(o.jmeno || o.id) + (jaSam ? ' <span class="stitek stitek-ja">(ty)</span>' : "") + "</td>";
        html += '<td><select data-uzivatel-role="' + esc(o.id) + '"' + (jaSam && jePosledniSuperadmin ? ' disabled title="Jsi poslední superadmin — nejdřív nastav superadmina na někoho jiného."' : "") + ">";
        ROLE_PORADI.forEach(function (rk) {
          html += '<option value="' + esc(rk) + '"' + (u.role === rk ? " selected" : "") + ">" + esc(nazevRole(pristupy.role, rk)) + "</option>";
        });
        html += "</select></td>";

        var token = urovenTokenu(o.id, u.role);
        // Použité třídy schválně existující ve styles.css (.stitek/.stitek-role,
        // tlumený štítek) — tenhle soubor si vlastní styly nepřidává.
        html += "<td>";
        html += '<span class="stitek stitek-role">' + esc(token.text) + "</span>";
        if (token.varovani) {
          html +=
            ' <span class="stitek" style="--stav-barva:var(--chyba)" title="' + esc(token.varovani.popis) + '">' +
            esc(token.varovani.stitek) + "</span>";
        }
        html += "</td>";

        html +=
          '<td><label class="prepinac"><input type="checkbox" data-uzivatel-aktivni="' + esc(o.id) + '"' +
          (u.aktivni !== false ? " checked" : "") + (jaSam ? ' disabled title="Nemůžeš deaktivovat sám sebe."' : "") + ">" +
          "<span>" + (u.aktivni !== false ? "aktivní" : "pozastaveno") + "</span></label></td>";
        html += "</tr>";
      });
      html += "</tbody></table></div>";
    }
    html += '<p class="napoveda">Deaktivace je organizační opatření. Trvalé odebrání přístupu člověku s právem zápisu vyžaduje rotaci tokenu — viz README.</p>';
    html +=
      '<p class="napoveda">Povýšení čtenáře na zapisující roli (editor / admin / superadmin) <strong>nestačí udělat tady</strong>. ' +
      "Čtenář má fyzicky jen read-only token, takže by mu každý zápis spadl na 403 a appka mu novou roli ani nedovolí použít. " +
      "Skutečné povýšení = spustit <code>scripts/nastav_pristup.py --pridej</code> (nebo <code>--rotace</code>), " +
      "vygenerovat nový <code>config.js</code> a znovu nasadit. Teprve pak má smysl přepnout roli zde.</p>";
    html += "</section>";
    return html;
  }

  function prekresliUzivatele() {
    var el = posledniKontejner && posledniKontejner.querySelector("#blok-uzivatele");
    if (!el) return;
    el.innerHTML = vykresliUzivatele();
  }

  function zmenitRoliUzivatele(id, novaRole) {
    var pristupy = dataPristupu();
    var jaSam = !!(Auth.ja && Auth.ja.id === id);
    var aktualni = (pristupy.uzivatele && pristupy.uzivatele[id]) || { role: "ctenar", aktivni: true };

    if (jaSam && aktualni.role === "superadmin" && novaRole !== "superadmin" && pocetAktivnichSuperadminu(pristupy) <= 1) {
      App.toast("Nemůžeš si sundat roli superadmina — jsi poslední superadmin. Nejdřív nastav superadmina na někoho jiného.", "chyba");
      prekresliUzivatele();
      return;
    }

    GH.zmen(
      "pristupy",
      function (data) {
        data.uzivatele = data.uzivatele || {};
        data.uzivatele[id] = data.uzivatele[id] || { aktivni: true };
        data.uzivatele[id].role = novaRole;
      },
      "Uživateli " + jmenoKonfigOsoby(id) + " nastavena role " + novaRole
    )
      .then(function (obsah) {
        ulozPristupy(obsah);
        App.toast("Role uživatele uložena.", "ok");
        prekresliUzivatele();
      })
      .catch(function (chyba) {
        App.toast((chyba && chyba.hlaska) || "Uložení role se nepovedlo.", "chyba");
        prekresliUzivatele();
      });
  }

  function zmenitAktivituUzivatele(id, novaAktivni) {
    var jaSam = !!(Auth.ja && Auth.ja.id === id);
    if (jaSam) {
      App.toast("Nemůžeš deaktivovat sám sebe.", "chyba");
      prekresliUzivatele();
      return;
    }

    GH.zmen(
      "pristupy",
      function (data) {
        data.uzivatele = data.uzivatele || {};
        data.uzivatele[id] = data.uzivatele[id] || { role: "ctenar" };
        data.uzivatele[id].aktivni = novaAktivni;
      },
      "Uživatel " + jmenoKonfigOsoby(id) + " " + (novaAktivni ? "aktivován" : "pozastaven")
    )
      .then(function (obsah) {
        ulozPristupy(obsah);
        App.toast(novaAktivni ? "Uživatel aktivován." : "Uživatel pozastaven.", "ok");
        prekresliUzivatele();
      })
      .catch(function (chyba) {
        App.toast((chyba && chyba.hlaska) || "Uložení se nepovedlo.", "chyba");
        prekresliUzivatele();
      });
  }

  // =========================================================
  // 3) Nastavení projektu
  // =========================================================

  function zajistiStagingNastaveni() {
    if (!stagingNastaveni) {
      var n = dataNastaveni();
      stagingNastaveni = {
        nazev: n.nazev || "",
        podnazev: n.podnazev || "",
        investor: n.investor || "",
        zhotovitel_stavba: n.zhotovitel_stavba || "",
        misto: n.misto || "",
        zahajeni: n.zahajeni || "",
        predani: n.predani || "",
        rozsah: {
          foto_sezeni: (n.rozsah && n.rozsah.foto_sezeni) || 0,
          dron_bloky: (n.rozsah && n.rozsah.dron_bloky) || 0,
          videa_prubezna: (n.rozsah && n.rozsah.videa_prubezna) || 0,
          video_souhrnne: (n.rozsah && n.rozsah.video_souhrnne) || 0,
          kamery: (n.rozsah && n.rozsah.kamery) || 0
        },
        odkazy: Array.isArray(n.odkazy) ? n.odkazy.map(function (o) { return { nazev: o.nazev || "", url: o.url || "" }; }) : []
      };
    }
    return stagingNastaveni;
  }

  function pole(id, name, popisek, typ, hodnota, povinne) {
    return (
      '<div class="pole"><label for="' + id + '">' + esc(popisek) + (povinne ? " *" : "") + "</label>" +
      '<input id="' + id + '" name="' + esc(name) + '" type="' + typ + '" value="' + esc(hodnota) + '"' + (povinne ? " required" : "") + "></div>"
    );
  }

  function poleCislo(id, name, popisek, hodnota) {
    return (
      '<div class="pole"><label for="' + id + '">' + esc(popisek) + "</label>" +
      '<input id="' + id + '" name="' + esc(name) + '" type="number" min="0" step="1" value="' + esc(hodnota != null ? hodnota : 0) + '"></div>'
    );
  }

  function vykresliNastaveni() {
    var s = zajistiStagingNastaveni();
    var html = '<section class="blok-spravy"><h3>Nastavení projektu</h3><form id="form-nastaveni" class="formular">';
    html += pole("n-nazev", "nazev", "Název", "text", s.nazev, true);
    html += pole("n-podnazev", "podnazev", "Podnázev", "text", s.podnazev);
    html += pole("n-investor", "investor", "Investor", "text", s.investor);
    html += pole("n-zhotovitel", "zhotovitel_stavba", "Zhotovitel stavby", "text", s.zhotovitel_stavba);
    html += pole("n-misto", "misto", "Místo", "text", s.misto);
    html += '<div class="pole-radek">' + pole("n-zahajeni", "zahajeni", "Zahájení (naše fáze 0)", "date", s.zahajeni) + pole("n-predani", "predani", "Termín předání", "date", s.predani) + "</div>";
    // Pozn.: záměrně BEZ .pole-radek — ta je flex-row bez wrapu (viz styles.css),
    // pěti číselných polí vedle sebe by na mobilu přeteklo. Necháno jako 5
    // samostatných .pole pod sebou (každé je samo o sobě blokové a responzivní).
    html += '<h4 class="podnadpis-formulare">Rozsah smlouvy</h4>';
    html += poleCislo("n-foto", "foto_sezeni", "Foto sezení", s.rozsah.foto_sezeni);
    html += poleCislo("n-dron", "dron_bloky", "Dron bloky", s.rozsah.dron_bloky);
    html += poleCislo("n-videa", "videa_prubezna", "Průběžná videa", s.rozsah.videa_prubezna);
    html += poleCislo("n-souhrn", "video_souhrnne", "Souhrnné video", s.rozsah.video_souhrnne);
    html += poleCislo("n-kamery", "kamery", "Kamery", s.rozsah.kamery);
    html += '<h4 class="podnadpis-formulare">Odkazy</h4><div id="seznam-odkazu" class="seznam-odkazu">';
    if (!s.odkazy.length) html += '<p class="prazdny-stav-mini">Zatím žádné odkazy.</p>';
    s.odkazy.forEach(function (o, i) {
      html +=
        '<div class="odkaz-radek"><span class="odkaz-nazev">' + esc(o.nazev) + "</span>" +
        (Util.bezpecnyOdkaz(o.url)
          ? '<a class="odkaz-url" href="' + esc(Util.bezpecnyOdkaz(o.url)) + '" target="_blank" rel="noopener noreferrer">' + esc(o.url) + "</a>"
          : '<span class="stitek stitek-chyba">' + esc(o.url) + " — neplatný odkaz, musí začínat https://</span>") +
        '<button type="button" class="btn-ikonovy btn-nebezpecny" data-akce="odebrat-odkaz" data-index="' + i + '" title="Odebrat odkaz">×</button></div>';
    });
    html += "</div>";
    html +=
      '<div class="pridat-odkaz-radek">' +
      '<input type="text" id="novy-odkaz-nazev" placeholder="Název odkazu">' +
      '<input type="url" id="novy-odkaz-url" placeholder="https://…">' +
      '<button type="button" class="btn btn-sekundarni" data-akce="pridat-odkaz">+ Přidat odkaz</button>' +
      "</div>";
    html += '<div class="formular-akce"><button type="submit" class="btn btn-primarni">Uložit nastavení</button></div>';
    html += "</form></section>";
    return html;
  }

  function prekresliNastaveni() {
    var el = posledniKontejner && posledniKontejner.querySelector("#blok-nastaveni");
    if (!el) return;
    el.innerHTML = vykresliNastaveni();
  }

  function pridatOdkaz() {
    var nazevEl = posledniKontejner.querySelector("#novy-odkaz-nazev");
    var urlEl = posledniKontejner.querySelector("#novy-odkaz-url");
    var nazev = (nazevEl.value || "").trim();
    var url = (urlEl.value || "").trim();
    if (!nazev || !/^https?:\/\//i.test(url)) {
      App.toast("Vyplň název odkazu a platnou URL (začínající http:// nebo https://).", "chyba");
      return;
    }
    zajistiStagingNastaveni().odkazy.push({ nazev: nazev, url: url });
    prekresliNastaveni();
  }

  function odebratOdkaz(index) {
    var s = zajistiStagingNastaveni();
    s.odkazy.splice(index, 1);
    prekresliNastaveni();
  }

  function ulozitNastaveni() {
    var s = zajistiStagingNastaveni();
    if (!String(s.nazev || "").trim()) {
      App.toast("Vyplň název projektu.", "chyba");
      return;
    }

    GH.zmen(
      "nastaveni",
      function (data) {
        data.nazev = s.nazev.trim();
        data.podnazev = s.podnazev.trim();
        data.investor = s.investor.trim();
        data.zhotovitel_stavba = s.zhotovitel_stavba.trim();
        data.misto = s.misto.trim();
        data.zahajeni = s.zahajeni;
        data.predani = s.predani;
        data.rozsah = data.rozsah || {};
        data.rozsah.foto_sezeni = s.rozsah.foto_sezeni;
        data.rozsah.dron_bloky = s.rozsah.dron_bloky;
        data.rozsah.videa_prubezna = s.rozsah.videa_prubezna;
        data.rozsah.video_souhrnne = s.rozsah.video_souhrnne;
        data.rozsah.kamery = s.rozsah.kamery;
        data.odkazy = s.odkazy.map(function (o) { return { nazev: o.nazev, url: o.url }; });
      },
      "Upraveno nastavení projektu"
    )
      .then(function (obsah) {
        ulozNastaveni(obsah);
        stagingNastaveni = null;
        App.toast("Nastavení projektu uloženo.", "ok");
        prekresliNastaveni();
      })
      .catch(function (chyba) {
        App.toast((chyba && chyba.hlaska) || "Uložení se nepovedlo.", "chyba");
      });
  }

  // =========================================================
  // společné posluchače
  // =========================================================

  function napojPosluchace(kontejner) {
    kontejner.dataset.aktivniSekce = "sprava";
    if (kontejner._spravaNapojeno) return;
    kontejner._spravaNapojeno = true;

    kontejner.addEventListener("click", function (e) {
      if (kontejner.dataset.aktivniSekce !== "sprava") return;
      var btn = e.target.closest("[data-akce]");
      if (!btn) return;
      var akce = btn.dataset.akce;
      if (akce === "ulozit-matici") ulozitMatici();
      else if (akce === "vratit-vychozi") vratitNaVychozi();
      else if (akce === "pridat-odkaz") pridatOdkaz();
      else if (akce === "odebrat-odkaz") odebratOdkaz(Number(btn.dataset.index));
    });

    kontejner.addEventListener("change", function (e) {
      if (kontejner.dataset.aktivniSekce !== "sprava") return;

      var cb = e.target.closest('input[type="checkbox"][data-role][data-pravo]');
      if (cb) {
        if (!cb.disabled) zajistiStagingMatice()[cb.dataset.role][cb.dataset.pravo] = cb.checked;
        return;
      }
      var selRole = e.target.closest("select[data-uzivatel-role]");
      if (selRole) {
        zmenitRoliUzivatele(selRole.dataset.uzivatelRole, selRole.value);
        return;
      }
      var tglAktivni = e.target.closest('input[type="checkbox"][data-uzivatel-aktivni]');
      if (tglAktivni) {
        zmenitAktivituUzivatele(tglAktivni.dataset.uzivatelAktivni, tglAktivni.checked);
      }
    });

    kontejner.addEventListener("input", function (e) {
      if (kontejner.dataset.aktivniSekce !== "sprava") return;
      var el = e.target;
      if (!el.name || !el.closest("#form-nastaveni") || !stagingNastaveni) return;
      if (Object.prototype.hasOwnProperty.call(stagingNastaveni, el.name) && typeof stagingNastaveni[el.name] !== "object") {
        stagingNastaveni[el.name] = el.value;
      } else if (stagingNastaveni.rozsah && Object.prototype.hasOwnProperty.call(stagingNastaveni.rozsah, el.name)) {
        stagingNastaveni.rozsah[el.name] = Number(el.value) || 0;
      }
    });

    kontejner.addEventListener("submit", function (e) {
      if (kontejner.dataset.aktivniSekce !== "sprava") return;
      if (e.target && e.target.id === "form-nastaveni") {
        e.preventDefault();
        ulozitNastaveni();
      }
    });
  }

  App.registrujSekci("sprava", vykresli);
})();
