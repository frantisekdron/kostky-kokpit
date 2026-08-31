/* js/view-pripominky.js — sekce „Připomínky" (nefunguje / úprava / dotaz).
 *
 * Jedno místo, kam kdokoli napíše, že něco nejde, že by něco chtěl jinak,
 * nebo se na něco zeptá. Nahrazuje to, co by se jinak řešilo v SMS a mailech.
 *
 * Data: data/pripominky.json, obálka { verze, zmeneno, zmenil, polozky }.
 * Položka: { id, cislo, druh, nazev, popis, kde, stav, zavaznost, kdo, kdy,
 *            vyresil, vyreseno_kdy, odpoved, odpovedi, zminky, smazano }
 *
 * Pozor na dvě podobně znějící pole, která znamenají něco jiného:
 *   `odpoved`  — JEDEN text, který napíše superadmin, když připomínku vyřídí
 *                nebo zamítne. Na kartě se ukazuje jako „Vyřízení".
 *   `odpovedi` — VLÁKNO. Pole záznamů
 *                { id, text, kdo, kdy, zminky, smazano }, nejstarší nahoře.
 *                Odpovídat smí každý, kdo smí připomínku napsat. Odpověď
 *                nejde upravit (historii nepřepisujeme), jen měkce smazat —
 *                a to jen jejím autorem nebo superadminem.
 *                Starší záznamy pole vůbec nemají, chybějící = prázdné.
 *
 * `zminky` je pole os-id lidí, kterým má o připomínce přijít upozornění na
 * mail (rozesílá ho GitHub Action nad datovým repem — appka mail odeslat
 * neumí). Starší záznamy pole nemají, chybějící = prázdné (Util.zminky).
 * Když někdo připomínku vyřeší, přidá se mezi zmínky její autor, ať se
 * dozví, že je hotová.
 *
 * Práva: pripominky.pridat (superadmin/admin/editor) = smí zapsat připomínku
 *        pripominky.resit  (superadmin/admin)        = smí měnit stav a odpovídat
 *
 * ČTENÁŘI mají read-only token — zápis jim technicky
 * nemůže projít. Místo mrtvého tlačítka dostanou stejný formulář, který jim
 * text připraví do schránky a otevře rozepsaný mail Honzovi. Je to poctivější
 * než tvářit se, že to uloží, a použitelnější než nic. Až bude potřeba, aby
 * psali přímo, stačí jim změnit roli přes scripts/nastav_pristup.py --pridej.
 *
 * Nevystavuje žádný globální objekt — registruje se jako sekce "pripominky".
 */

(function () {
  "use strict";

  var esc = Util.esc;

  var DRUHY = [
    { kod: "nejde", nazev: "Něco nejde", popis: "Něco je rozbité nebo se to chová jinak, než má." },
    { kod: "uprava", nazev: "Návrh úpravy", popis: "Funguje to, ale šlo by to udělat líp." },
    { kod: "dotaz", nazev: "Dotaz", popis: "Nevím, jak na to, nebo si nejsem jistý." }
  ];

  var STAVY = [
    { kod: "nova", nazev: "Nová", barva: "var(--varovani)" },
    { kod: "resi-se", nazev: "Řeší se", barva: "var(--modra-porr)" },
    { kod: "hotovo", nazev: "Vyřešeno", barva: "var(--ok)" },
    { kod: "zamitnuto", nazev: "Neřešíme", barva: "var(--text-slaby)" }
  ];

  var FILTRY = [
    { kod: "otevrene", nazev: "Otevřené" },
    { kod: "vse", nazev: "Vše" },
    { kod: "nejde", nazev: "Něco nejde" },
    { kod: "moje", nazev: "Moje" }
  ];

  var aktivniFiltr = "otevrene";
  var naposledyZHashe = "";   // ať se proklik z mailu neaplikuje při každém překreslení
  var zvyraznit = null;       // id připomínky, ke které se má odrolovat

  // Které vlákno odpovědí má člověk rozbalené. App.prekresli() překresluje
  // sekci celou, takže by se vlákno po každém zápisu zase sbalilo — tohle si
  // to pamatuje mezi vykresleními. Klíč = id připomínky, hodnota = true/false.
  var otevrenaVlakna = {};

  // ---- pomocné ----

  function polozky() {
    return App.polozky("pripominky").filter(function (p) { return !p.smazano; });
  }

  function popisDruhu(kod) {
    for (var i = 0; i < DRUHY.length; i++) if (DRUHY[i].kod === kod) return DRUHY[i];
    return DRUHY[2];
  }

  function popisStavu(kod) {
    for (var i = 0; i < STAVY.length; i++) if (STAVY[i].kod === kod) return STAVY[i];
    return STAVY[0];
  }

  function smiPsat() { return Auth.can("pripominky.pridat"); }
  function smiResit() { return Auth.can("pripominky.resit"); }

  function mojeOsobaId() {
    return (Auth.ja && Auth.ja.osoba_id) || null;
  }

  // Živé (nesmazané) odpovědi jedné připomínky, nejstarší nahoře. Starší
  // záznamy pole `odpovedi` vůbec nemají — chybějící i rozbité se bere jako
  // prázdné, nikdy jako chyba (stejně jako Util.zminky u zmínek).
  function odpovediZaznamu(p) {
    if (!p || !Array.isArray(p.odpovedi)) return [];
    return p.odpovedi
      .filter(function (o) { return o && o.id && !o.smazano; })
      .slice()
      .sort(function (a, b) {
        return String(a.kdy || "").localeCompare(String(b.kdy || ""));
      });
  }

  // gh.js by holou Error obalil do „Neočekávaná chyba: …“. S nastavenou
  // vlastností `hlaska` projde text beze změny až do toastu.
  function pocetPripominek(kolik) {
    if (kolik === 1) return "1 připomínku";
    if (kolik >= 2 && kolik <= 4) return kolik + " připomínky";
    return kolik + " připomínek";
  }

  function chybaProUzivatele(text) {
    var chyba = new Error(text);
    chyba.hlaska = text;
    return chyba;
  }

  // POZOR: počítá se z pole, které přišlo z čerstvého GETu uvnitř mutátoru,
  // ne z App.polozky() (to je lokální kopie a při souběhu dala dvě připomínky
  // se stejným číslem — a mail i aktivita se pak odkazovaly na dvě různé věci).
  function dalsiCislo(pol) {
    var max = 0;
    (pol || App.polozky("pripominky")).forEach(function (p) {
      if (typeof p.cislo === "number" && p.cislo > max) max = p.cislo;
    });
    return max + 1;
  }

  // Seznam sekcí, kterých se připomínka může týkat — ať se nepíše volným textem
  // a dá se pak filtrovat.
  var SEKCE_KDE = ["Přehled", "Návštěvy", "Plán stavby", "Časosběr", "Materiály",
    "Materiál pro Emauzy", "Tým", "Koš", "Správa", "Něco jiného"];

  // ---- text pro čtenáře (do schránky a do mailu) ----

  function textPripominky(data) {
    var radky = [];
    radky.push("Kokpit Pragerovy kostky — " + popisDruhu(data.druh).nazev.toLowerCase());
    radky.push("");
    radky.push("Čeho se to týká: " + (data.kde || "neuvedeno"));
    radky.push("Stručně: " + data.nazev);
    if (data.popis) {
      radky.push("");
      radky.push(data.popis);
    }
    if (data.zavaznost === "blokuje") {
      radky.push("");
      radky.push("POZOR: tohle mi brání v práci.");
    }
    var radekZminek = Util.zminkyText(data.zminky);
    if (radekZminek) {
      radky.push("");
      radky.push(radekZminek);
    }
    radky.push("");
    var ja = Auth.ja && Auth.ja.jmeno ? Auth.ja.jmeno : "";
    if (ja) radky.push("Píše: " + ja);
    return radky.join("\n");
  }

  // Odpověď připravená do schránky a do mailu — pro čtenáře, kterému by
  // zápis stejně neprošel (read-only token).
  function textOdpovedi(p, data) {
    var radky = [];
    radky.push("Kokpit Pragerovy kostky — odpověď na připomínku č. " + p.cislo);
    radky.push("");
    radky.push("Připomínka: " + (p.nazev || "(bez názvu)"));
    radky.push("");
    radky.push(data.text);

    // Autor připomínky patří mezi upozorněné i tady, ať e-mail říká totéž,
    // co by uložil zápis. Sám sebe si člověk neoznačuje.
    var komu = (data.zminky || []).slice();
    if (p.kdo && p.kdo !== mojeOsobaId() && komu.indexOf(p.kdo) === -1) {
      komu.push(p.kdo);
    }
    var radekZminek = Util.zminkyText(komu);
    if (radekZminek) {
      radky.push("");
      radky.push(radekZminek);
    }

    radky.push("");
    var ja = Auth.ja && Auth.ja.jmeno ? Auth.ja.jmeno : "";
    if (ja) radky.push("Píše: " + ja);
    return radky.join("\n");
  }

  // ---- formulář ----

  function otevriFormular(existujici) {
    var jeNova = !existujici;
    var form = document.createElement("form");
    form.className = "formular";
    form.addEventListener("submit", function (e) { e.preventDefault(); });

    function pole(popisek, prvek, napoveda) {
      var obal = App.el("div", "pole");
      var lab = App.el("label", null, popisek);
      var id = "pri-" + Math.random().toString(36).slice(2, 8);
      lab.setAttribute("for", id);
      prvek.id = id;
      prvek.className = (prvek.className || "") + " vstup";
      obal.appendChild(lab);
      obal.appendChild(prvek);
      if (napoveda) obal.appendChild(App.el("p", "napoveda", napoveda));
      form.appendChild(obal);
      return prvek;
    }

    var vyberDruhu = document.createElement("select");
    DRUHY.forEach(function (d) {
      var o = document.createElement("option");
      o.value = d.kod;
      o.textContent = d.nazev;
      vyberDruhu.appendChild(o);
    });
    vyberDruhu.value = existujici ? existujici.druh : "nejde";
    pole("O co jde?", vyberDruhu);

    var napovedaDruhu = App.el("p", "napoveda", popisDruhu(vyberDruhu.value).popis);
    form.appendChild(napovedaDruhu);
    vyberDruhu.addEventListener("change", function () {
      napovedaDruhu.textContent = popisDruhu(vyberDruhu.value).popis;
    });

    var vyberKde = document.createElement("select");
    SEKCE_KDE.forEach(function (s) {
      var o = document.createElement("option");
      o.value = s;
      o.textContent = s;
      vyberKde.appendChild(o);
    });
    vyberKde.value = existujici ? (existujici.kde || "Něco jiného") : "Něco jiného";
    pole("Kde se to stalo?", vyberKde);

    var vstupNazev = document.createElement("input");
    vstupNazev.type = "text";
    vstupNazev.maxLength = 120;
    vstupNazev.value = existujici ? existujici.nazev : "";
    vstupNazev.placeholder = "Jednou větou, o co jde";
    pole("Stručně", vstupNazev);

    var vstupPopis = document.createElement("textarea");
    vstupPopis.rows = 5;
    vstupPopis.value = existujici ? existujici.popis : "";
    vstupPopis.placeholder = "Co jste dělal(a), co se stalo a co jste čekal(a), že se stane.";
    pole("Podrobněji", vstupPopis, "Čím konkrétnější, tím rychleji to spravíme.");

    var vstupBlokuje = document.createElement("input");
    vstupBlokuje.type = "checkbox";
    vstupBlokuje.checked = existujici ? existujici.zavaznost === "blokuje" : false;
    var obalBlokuje = App.el("label", "pole-zaskrtavatko");
    obalBlokuje.appendChild(vstupBlokuje);
    obalBlokuje.appendChild(document.createTextNode(" Brání mi to v práci"));
    form.appendChild(obalBlokuje);

    // Koho o připomínce upozornit mailem. Sám sebe si člověk neoznačuje —
    // kdo píše, ten upozornění nedostává.
    var vyberZminek = Util.vyberZminek({
      vybrane: Util.zminky(existujici),
      vynech: mojeOsobaId()
    });
    form.appendChild(vyberZminek.prvek);

    function sesbirej() {
      return {
        druh: vyberDruhu.value,
        kde: vyberKde.value,
        nazev: vstupNazev.value.trim(),
        popis: vstupPopis.value.trim(),
        zavaznost: vstupBlokuje.checked ? "blokuje" : "bezna",
        zminky: vyberZminek.vybrane()
      };
    }

    var akce = [{ text: "Zavřít", druh: "sekundarni", fn: function () { modal.zavri(); } }];

    if (smiPsat()) {
      akce.push({
        text: jeNova ? "Odeslat" : "Uložit",
        druh: "primarni",
        fn: function () {
          var data = sesbirej();
          if (data.nazev.length < 3) {
            App.toast("Napište aspoň krátce, o co jde.", "chyba");
            return;
          }
          uloz(jeNova, existujici, data).then(function (ok) {
            if (ok) modal.zavri();
          });
        }
      });
    } else {
      // Čtenář — read-only token, zápis by neprošel. Připravíme text.
      akce.push({
        text: "Zkopírovat a poslat mailem",
        druh: "primarni",
        fn: function () {
          var data = sesbirej();
          if (data.nazev.length < 3) {
            App.toast("Napište aspoň krátce, o co jde.", "chyba");
            return;
          }
          var text = textPripominky(data);
          Util.doSchranky(text).then(function (ok) {
            App.toast(ok ? "Text zkopírován." : "Text se nepodařilo zkopírovat.", ok ? "ok" : "chyba");
          });
          var predmet = "Kokpit Pragerovy kostky — " + data.nazev;
          window.location.href = "mailto:honza@frantisekdron.cz?subject=" +
            encodeURIComponent(predmet) + "&body=" + encodeURIComponent(text);
        }
      });
    }

    if (!jeNova && smiResit()) {
      akce.push({
        text: "Smazat (do koše)",
        druh: "nebezpecny",
        fn: function () {
          modal.zavri();
          smaz(existujici);
        }
      });
    }

    if (!smiPsat()) {
      var vysvetleni = App.el("p", "napoveda",
        "Máte přístup jen ke čtení, takže zápis přímo do kokpitu vám neprojde. " +
        "Tlačítko níž vám připomínku připraví do schránky a otevře rozepsaný " +
        "e-mail — stačí odeslat.");
      form.appendChild(vysvetleni);
    }

    var modal = App.modal({
      nadpis: jeNova ? "Nová připomínka" : "Připomínka č. " + existujici.cislo,
      obsah: form,
      akce: akce
    });
    return modal;
  }

  // ---- formulář odpovědi ----

  function otevriOdpoved(p) {
    var ja = mojeOsobaId();
    // Upozornění dostanou automaticky autor připomínky a všichni, kdo už ve
    // vláknu odpovídali — do výběru se proto nedávají a řekne se to větou.
    var automaticky = [];
    function pridejAutomaticky(osobaId) {
      if (osobaId && osobaId !== ja && automaticky.indexOf(osobaId) === -1) {
        automaticky.push(osobaId);
      }
    }
    pridejAutomaticky(p.kdo);
    (p.odpovedi || []).forEach(function (o) {
      if (o && !o.smazano) pridejAutomaticky(o.kdo);
    });

    var form = document.createElement("form");
    form.className = "formular";
    form.addEventListener("submit", function (e) { e.preventDefault(); });

    // Na co se vlastně odpovídá — v modálu už karta vidět není.
    form.appendChild(App.el("p", "odpoved-citace", p.nazev || "(bez názvu)"));

    var obalPole = App.el("div", "pole");
    var idPole = "odp-" + Math.random().toString(36).slice(2, 8);
    var popisek = App.el("label", null, "Odpověď");
    popisek.setAttribute("for", idPole);
    var vstupText = document.createElement("textarea");
    vstupText.id = idPole;
    vstupText.className = "vstup";
    vstupText.rows = 4;
    vstupText.placeholder = "Jak to je, nebo co se s tím bude dít.";
    obalPole.appendChild(popisek);
    obalPole.appendChild(vstupText);
    form.appendChild(obalPole);

    // Autor připomínky dostane upozornění vždycky — ať se dozví, že mu někdo
    // odpověděl. Není proto ve výběru: zaškrtávátko, které nejde odškrtnout,
    // je horší než věta, která to rovnou řekne.
    if (automaticky.length) {
      // Bez téhle poznámky appka slibovala upozornění i lidem, kteří nemají
      // v týmu vyplněnou adresu — a mail jim nikdy nedorazil.
      var jmena = automaticky.map(function (osobaId) {
        var osoba = App.osoba(osobaId);
        var jmeno = App.jmenoOsoby(osobaId);
        var maMail = !!(osoba && typeof osoba.email === "string" && osoba.email.trim());
        return maMail ? jmeno : jmeno + " (nemá e-mail, upozornění nedorazí)";
      });
      form.appendChild(App.el("p", "napoveda",
        (automaticky.length === 1
          ? "Upozornění dostane automaticky: "
          : "Upozornění dostanou automaticky všichni z vlákna: ") + jmena.join(", ") + "."));
    }

    // Kdo píše, ten upozornění nedostává (`ja`); automaticky upozornění jsou
    // ošetření výš. Zbytek týmu jde označit ručně.
    var vyberZminek = Util.vyberZminek({
      lide: App.polozky("lide").filter(function (o) {
        return o && o.id && !o.smazano && o.id !== ja && automaticky.indexOf(o.id) === -1;
      }),
      veta: "Komu dalšímu má o odpovědi přijít upozornění na mail?"
    });
    form.appendChild(vyberZminek.prvek);

    function sesbirej() {
      return {
        text: vstupText.value.trim(),
        zminky: vyberZminek.vybrane()
      };
    }

    function zkontroluj(data) {
      if (data.text.length < 2) {
        App.toast("Napište aspoň krátce, co odpovídáte.", "chyba");
        return false;
      }
      return true;
    }

    var akce = [{ text: "Zavřít", druh: "sekundarni", fn: function () { modal.zavri(); } }];

    if (smiPsat()) {
      // Zápis na GitHub chvíli trvá. Bez téhle pojistky založil netrpělivý
      // dvojklik dvě stejné odpovědi — a odpověď se nedá editovat, takže
      // jedinou nápravou by bylo mazání (mail o obou už přitom odešel).
      var probihaZapis = false;
      akce.push({
        text: "Odeslat odpověď",
        druh: "primarni",
        fn: function () {
          if (probihaZapis) return;
          var data = sesbirej();
          if (!zkontroluj(data)) return;
          probihaZapis = true;
          ulozOdpoved(p, data).then(function (ok) {
            probihaZapis = false;
            if (ok) modal.zavri();
          });
        }
      });
    } else {
      // Čtenář — read-only token, zápis by neprošel. Stejný vzorec jako
      // u formuláře připomínky: text do schránky a rozepsaný mail.
      akce.push({
        text: "Zkopírovat a poslat mailem",
        druh: "primarni",
        fn: function () {
          var data = sesbirej();
          if (!zkontroluj(data)) return;
          var text = textOdpovedi(p, data);
          Util.doSchranky(text).then(function (ok) {
            App.toast(ok ? "Text zkopírován." : "Text se nepodařilo zkopírovat.", ok ? "ok" : "chyba");
          });
          var predmet = "Kokpit Pragerovy kostky — odpověď na připomínku č. " + p.cislo;
          window.location.href = "mailto:honza@frantisekdron.cz?subject=" +
            encodeURIComponent(predmet) + "&body=" + encodeURIComponent(text);
        }
      });
      form.appendChild(App.el("p", "napoveda",
        "Máte přístup jen ke čtení, takže zápis přímo do kokpitu vám neprojde. " +
        "Tlačítko níž vám odpověď připraví do schránky a otevře rozepsaný " +
        "e-mail — stačí odeslat."));
    }

    var modal = App.modal({
      nadpis: "Odpověď na připomínku č. " + p.cislo,
      obsah: form,
      akce: akce
    });
    return modal;
  }

  // ---- zápisy ----

  function uloz(jeNova, existujici, data) {
    var popisZmeny;
    return GH.zmen("pripominky", function (pol) {
      if (jeNova) {
        pol.push({
          id: GH.noveId("pri"),
          cislo: dalsiCislo(pol),
          druh: data.druh,
          nazev: data.nazev,
          popis: data.popis,
          kde: data.kde,
          stav: "nova",
          zavaznost: data.zavaznost,
          kdo: mojeOsobaId(),
          kdy: new Date().toISOString(),
          vyresil: null,
          vyreseno_kdy: null,
          odpoved: "",
          odpovedi: [],
          zminky: data.zminky || [],
          smazano: null
        });
        popisZmeny = "Nová připomínka: " + data.nazev;
      } else {
        var cil = pol.find(function (p) { return p.id === existujici.id; });
        if (!cil) {
          throw chybaProUzivatele("Připomínka mezitím zmizela — změna se neuložila. "
            + "Načtěte stránku znovu.");
        }
        cil.druh = data.druh;
        cil.nazev = data.nazev;
        cil.popis = data.popis;
        cil.kde = data.kde;
        cil.zavaznost = data.zavaznost;
        cil.zminky = data.zminky || [];
        popisZmeny = "Upravena připomínka č. " + cil.cislo;
      }
    }, popisZmeny || "Připomínka")
      .then(function (obsah) {
        App.uloz("pripominky", obsah);
        App.toast(jeNova ? "Připomínka odeslána." : "Uloženo.", "ok");
        App.prekresli();
        return true;
      })
      .catch(function (chyba) {
        App.toast(chyba && chyba.message ? chyba.message : "Uložení se nepovedlo.", "chyba");
        return false;
      });
  }

  function zmenStav(polozka, novyStav, odpoved) {
    return GH.zmen("pripominky", function (pol) {
      var cil = pol.find(function (p) { return p.id === polozka.id; });
      if (!cil) {
        throw chybaProUzivatele("Připomínka mezitím zmizela — stav se nezměnil. "
          + "Načtěte stránku znovu.");
      }
      cil.stav = novyStav;
      if (typeof odpoved === "string") cil.odpoved = odpoved;
      if (novyStav === "hotovo" || novyStav === "zamitnuto") {
        cil.vyresil = mojeOsobaId();
        cil.vyreseno_kdy = new Date().toISOString();
        // Autor se musí dozvědět, že je jeho připomínka vyřízená — označíme
        // ho tedy sami. Upozornění posíláme i bez odpovědi: "hotovo" bez
        // vysvětlení je pořád zpráva, kterou ten člověk potřebuje. Sám sobě
        // ho ale nikdo neposílá.
        var autor = cil.kdo;
        var stavajici = Util.zminky(cil);
        if (autor && autor !== mojeOsobaId() && stavajici.indexOf(autor) === -1) {
          cil.zminky = stavajici.concat([autor]);
        } else {
          cil.zminky = stavajici;
        }
      } else {
        cil.vyresil = null;
        cil.vyreseno_kdy = null;
      }
    }, "Připomínka č. " + polozka.cislo + " — " + popisStavu(novyStav).nazev)
      .then(function (obsah) {
        App.uloz("pripominky", obsah);
        App.prekresli();
      })
      .catch(function (chyba) {
        App.toast(chyba && chyba.message ? chyba.message : "Uložení se nepovedlo.", "chyba");
      });
  }

  function ulozOdpoved(p, data) {
    var ja = mojeOsobaId();
    return GH.zmen("pripominky", function (pol) {
      // Mutuje se výhradně podle id, nikdy podle indexu (§3 kontraktu) —
      // mezitím mohl kdokoli jiný do souboru zapsat.
      var cil = pol.find(function (x) { return x.id === p.id; });
      if (!cil) {
        throw chybaProUzivatele("Připomínka mezitím zmizela — odpověď se neuložila. "
          + "Zkopírujte si text a načtěte stránku znovu.");
      }
      if (cil.smazano) {
        throw chybaProUzivatele("Připomínka je v koši — odpovědět na ni nejde. "
          + "Nejdřív ji někdo musí vrátit.");
      }
      if (!Array.isArray(cil.odpovedi)) cil.odpovedi = [];

      // Upozornění dostane autor připomínky I všichni, kdo už v jejím vláknu
      // odpovídali — jinak by konverzace umřela hned u druhé odpovědi:
      // ten, komu odpovídám, by se to nedozvěděl. Sám sebe si nikdo
      // neoznačuje, proto se `ja` z výsledku vždycky vyhazuje.
      var zminky = (data.zminky || []).slice();
      var ucastnici = [cil.kdo];
      cil.odpovedi.forEach(function (o) {
        if (o && !o.smazano && o.kdo) ucastnici.push(o.kdo);
      });
      ucastnici.forEach(function (osobaId) {
        if (osobaId && osobaId !== ja && zminky.indexOf(osobaId) === -1) {
          zminky.push(osobaId);
        }
      });
      zminky = zminky.filter(function (osobaId) {
        return osobaId && osobaId !== ja;
      });

      cil.odpovedi.push({
        id: GH.noveId("odp"),
        text: data.text,
        kdo: ja,
        kdy: new Date().toISOString(),
        zminky: zminky,
        smazano: null
      });
    }, "Odpověď u připomínky č. " + p.cislo)
      .then(function (obsah) {
        App.uloz("pripominky", obsah);
        otevrenaVlakna[p.id] = true; // ať je hned vidět, co jsem napsal
        App.toast("Odpověď odeslána.", "ok");
        App.prekresli();
        return true;
      })
      .catch(function (chyba) {
        App.toast(chyba && chyba.message ? chyba.message : "Uložení se nepovedlo.", "chyba");
        return false;
      });
  }

  // Odpověď se needituje (historii nepřepisujeme) a nemizí nadobro — jen se
  // označí jako smazaná a přestane se zobrazovat.
  function smazOdpoved(p, odpoved) {
    App.potvrd("Smazat tuhle odpověď? Z vlákna zmizí, ale v datech zůstane.")
      .then(function (ano) {
        if (!ano) return;
        GH.zmen("pripominky", function (pol) {
          var cil = pol.find(function (x) { return x.id === p.id; });
          if (!cil || !Array.isArray(cil.odpovedi)) {
            throw chybaProUzivatele("Připomínka mezitím zmizela — nic se nezměnilo.");
          }
          var terc = cil.odpovedi.find(function (o) { return o && o.id === odpoved.id; });
          if (!terc) {
            throw chybaProUzivatele("Odpověď se nenašla — nejspíš ji mezitím smazal někdo jiný.");
          }
          terc.smazano = { kdy: new Date().toISOString(), kdo: mojeOsobaId() };
        }, "Smazána odpověď u připomínky č. " + p.cislo)
          .then(function (obsah) {
            App.uloz("pripominky", obsah);
            otevrenaVlakna[p.id] = true;
            App.toast("Odpověď smazána.", "ok");
            App.prekresli();
          })
          .catch(function (chyba) {
            App.toast(chyba && chyba.message ? chyba.message : "Uložení se nepovedlo.", "chyba");
          });
      });
  }

  function smaz(polozka) {
    App.potvrd("Přesunout připomínku č. " + polozka.cislo + " do koše?").then(function (ano) {
      if (!ano) return;
      GH.zmen("pripominky", function (pol) {
        var cil = pol.find(function (p) { return p.id === polozka.id; });
        if (cil) cil.smazano = { kdy: new Date().toISOString(), kdo: mojeOsobaId() };
      }, "Připomínka č. " + polozka.cislo + " do koše")
        .then(function (obsah) {
          App.uloz("pripominky", obsah);
          App.toast("Přesunuto do koše.", "ok");
          App.prekresli();
        })
        .catch(function (chyba) {
          App.toast(chyba && chyba.message ? chyba.message : "Uložení se nepovedlo.", "chyba");
        });
    });
  }

  // ---- vykreslení ----

  // Jedna odpověď ve vlákně: kdo, kdy, text a řádek s označenými lidmi.
  function bublinaOdpovedi(p, o, ja) {
    var blok = App.el("div", "odpoved-polozka");

    var hlavicka = App.el("div", "odpoved-hlavicka");
    hlavicka.appendChild(App.el("span", "odpoved-kdo", App.jmenoOsoby(o.kdo)));
    hlavicka.appendChild(App.el("span", "odpoved-kdy", Util.formatCas(o.kdy)));

    // Smazat smí autor odpovědi (musí ale pořád mít právo psát) a superadmin
    // kteroukoli.
    var muzeSmazat = (smiPsat() && o.kdo && o.kdo === ja) || smiResit();
    if (muzeSmazat) {
      var btnSmazat = App.el("button", "btn-ikonovy btn-nebezpecny odpoved-smazat", "×");
      btnSmazat.type = "button";
      btnSmazat.title = "Smazat odpověď";
      btnSmazat.setAttribute("aria-label",
        "Smazat odpověď od " + App.jmenoOsoby(o.kdo) + " ze " + Util.formatCas(o.kdy));
      btnSmazat.addEventListener("click", function () { smazOdpoved(p, o); });
      hlavicka.appendChild(btnSmazat);
    }
    blok.appendChild(hlavicka);

    blok.appendChild(App.el("p", "odpoved-text", o.text || ""));

    var radekZminek = Util.radekZminek(Util.zminky(o));
    if (radekZminek) blok.appendChild(radekZminek);

    return blok;
  }

  // Vlákno odpovědí pod připomínkou. Vrací null, když ještě žádná není —
  // prázdný blok „Odpovědi 0" by kartu jen zaplevelil.
  function vlaknoOdpovedi(p) {
    var seznam = odpovediZaznamu(p);
    if (!seznam.length) return null;

    var ja = mojeOsobaId();

    var obal = document.createElement("details");
    obal.className = "odpovedi";

    // Počet je v souhrnu, takže je vidět i když je vlákno sbalené.
    var shrnuti = document.createElement("summary");
    shrnuti.className = "odpovedi-summary";
    shrnuti.appendChild(App.el("span", "odpovedi-veta", "Odpovědi"));
    shrnuti.appendChild(App.el("span", "odpovedi-pocet", String(seznam.length)));
    obal.appendChild(shrnuti);

    var telo = App.el("div", "odpovedi-telo");
    seznam.forEach(function (o) { telo.appendChild(bublinaOdpovedi(p, o, ja)); });
    obal.appendChild(telo);

    // Krátké vlákno rozbalené (není co schovávat), delší sbalené, ať karta
    // nepřeroste. Co si člověk sám rozbalí nebo sbalí, to má přednost.
    var zapamatovane = otevrenaVlakna[p.id];
    obal.open = zapamatovane === undefined ? seznam.length <= 3 : !!zapamatovane;
    obal.addEventListener("toggle", function () {
      otevrenaVlakna[p.id] = obal.open;
    });

    return obal;
  }

  function kartaPripominky(p) {
    var stav = popisStavu(p.stav);
    var karta = App.el("div", "karta karta-pripominka");
    karta.style.setProperty("--stav-barva", stav.barva);

    var hlavicka = App.el("div", "karta-hlavicka");
    var kontrolka = App.el("span", "sync-tecka pripominka-tecka");
    kontrolka.style.background = stav.barva;
    kontrolka.setAttribute("aria-hidden", "true");
    hlavicka.appendChild(kontrolka);

    var nadpis = App.el("h3", "karta-nadpis",
      "č. " + p.cislo + " — " + (p.nazev || "(bez názvu)"));
    hlavicka.appendChild(nadpis);
    karta.appendChild(hlavicka);

    var stitky = App.el("div", "dlazdice-stitky");
    var stitekStav = App.el("span", "stitek", stav.nazev);
    stitekStav.style.color = stav.barva;
    stitky.appendChild(stitekStav);
    stitky.appendChild(App.el("span", "stitek", popisDruhu(p.druh).nazev));
    if (p.kde) stitky.appendChild(App.el("span", "stitek", p.kde));
    if (p.zavaznost === "blokuje") {
      stitky.appendChild(App.el("span", "stitek stitek-chyba", "brání v práci"));
    }
    karta.appendChild(stitky);

    if (p.popis) karta.appendChild(App.el("p", "karta-popis", p.popis));

    var kdo = App.jmenoOsoby(p.kdo);
    karta.appendChild(App.el("p", "karta-meta",
      "Napsal(a) " + kdo + " · " + Util.formatCas(p.kdy)));

    if (p.odpoved) {
      // Jednorázová poznámka superadmina při vyřízení — něco jiného než
      // vlákno odpovědí níž, proto i jiný název.
      var odp = App.el("div", "karta-odpoved");
      odp.appendChild(App.el("strong", null, "Vyřízení: "));
      odp.appendChild(document.createTextNode(p.odpoved));
      karta.appendChild(odp);
    }
    if (p.vyresil) {
      karta.appendChild(App.el("p", "karta-meta",
        "Vyřídil(a) " + App.jmenoOsoby(p.vyresil) + " · " + Util.formatCas(p.vyreseno_kdy)));
    }

    var radekZminek = Util.radekZminek(Util.zminky(p));
    if (radekZminek) karta.appendChild(radekZminek);

    var vlakno = vlaknoOdpovedi(p);
    if (vlakno) karta.appendChild(vlakno);

    var akce = App.el("div", "karta-akce");

    if (smiResit()) {
      var vyberStavu = document.createElement("select");
      vyberStavu.className = "vstup";
      vyberStavu.setAttribute("aria-label", "Stav připomínky č. " + p.cislo);
      STAVY.forEach(function (s) {
        var o = document.createElement("option");
        o.value = s.kod;
        o.textContent = s.nazev;
        vyberStavu.appendChild(o);
      });
      vyberStavu.value = p.stav;
      vyberStavu.addEventListener("change", function () {
        var novy = vyberStavu.value;
        if (novy === "hotovo" || novy === "zamitnuto") {
          var pole = document.createElement("textarea");
          pole.rows = 3;
          pole.className = "vstup";
          pole.value = p.odpoved || "";
          pole.placeholder = novy === "hotovo"
            ? "Co jsme s tím udělali."
            : "Proč to neřešíme.";
          var obal = App.el("div", "formular");
          var lab = App.el("label", null, "Vyřízení (nepovinné)");
          obal.appendChild(lab);
          obal.appendChild(pole);
          var m = App.modal({
            nadpis: popisStavu(novy).nazev + " — připomínka č. " + p.cislo,
            obsah: obal,
            akce: [
              { text: "Zrušit", druh: "sekundarni", fn: function () {
                vyberStavu.value = p.stav; m.zavri();
              } },
              { text: "Uložit", druh: "primarni", fn: function () {
                m.zavri(); zmenStav(p, novy, pole.value.trim());
              } }
            ]
          });
        } else {
          zmenStav(p, novy);
        }
      });
      akce.appendChild(vyberStavu);
    }

    // Odpovídat smí každý, kdo smí připomínku napsat. Čtenáři tlačítko
    // zůstává — otevře mu formulář, který text připraví do schránky a mailu.
    var btnOdpovedet = App.el("button", "btn btn-mala btn-sekundarni",
      smiPsat() ? "Odpovědět" : "Odpovědět (pošle se mailem)");
    btnOdpovedet.type = "button";
    btnOdpovedet.addEventListener("click", function () { otevriOdpoved(p); });
    akce.appendChild(btnOdpovedet);

    var muzeUpravit = smiPsat() && (smiResit() || p.kdo === mojeOsobaId());
    if (muzeUpravit) {
      var btnUpravit = App.el("button", "btn btn-mala btn-sekundarni", "Upravit");
      btnUpravit.type = "button";
      btnUpravit.addEventListener("click", function () { otevriFormular(p); });
      akce.appendChild(btnUpravit);
    }

    if (akce.childNodes.length) karta.appendChild(akce);
    return karta;
  }

  function vykresli(kontejner) {
    kontejner.innerHTML = "";

    var vsechny = polozky();

    // Proklik z upozorňovacího mailu: #pripominky/<id>. Bez tohohle by
    // adresát u vyřízené připomínky přistál na prázdném seznamu, protože
    // výchozí filtr „Otevřené“ pouští jen nova/resi-se.
    var zHashe = (typeof App.parametrHashe === "function") ? App.parametrHashe() : "";
    if (zHashe && zHashe !== naposledyZHashe) {
      naposledyZHashe = zHashe;
      var hledana = vsechny.filter(function (p) { return p.id === zHashe; })[0];
      if (hledana) {
        aktivniFiltr = "vse";
        otevrenaVlakna[hledana.id] = true;
        zvyraznit = hledana.id;
      }
    }

    var hlavicka = App.el("div", "sekce-hlavicka");
    hlavicka.appendChild(App.el("h2", "nadpis-sekce", "Připomínky"));
    hlavicka.appendChild(App.el("p", "podnadpis-sekce",
      "Něco nejde, nebo byste to chtěli jinak? Napište to sem — je to jedno " +
      "místo pro všechny místo esemesek a mailů."));
    kontejner.appendChild(hlavicka);

    var otevrenych = vsechny.filter(function (p) {
      return p.stav === "nova" || p.stav === "resi-se";
    }).length;
    var blokujicich = vsechny.filter(function (p) {
      return p.zavaznost === "blokuje" && (p.stav === "nova" || p.stav === "resi-se");
    }).length;

    var souhrn = App.el("p", "karta-meta",
      "Otevřených: " + otevrenych + " z " + vsechny.length +
      (blokujicich ? " · z toho " + blokujicich + " někomu brání v práci" : ""));
    kontejner.appendChild(souhrn);

    var pruhAkci = App.el("div", "karta-akce");
    var btnNova = App.el("button", "btn btn-primarni",
      smiPsat() ? "+ Napsat připomínku" : "+ Napsat připomínku (pošle se mailem)");
    btnNova.type = "button";
    btnNova.addEventListener("click", function () { otevriFormular(null); });
    pruhAkci.appendChild(btnNova);
    kontejner.appendChild(pruhAkci);

    // filtry s počty
    var pruhFiltru = App.el("div", "galerie-filtr");
    FILTRY.forEach(function (f) {
      var kolik = filtruj(vsechny, f.kod).length;
      var tl = App.el("button", "filtr-tlacitko" +
        (aktivniFiltr === f.kod ? " filtr-tlacitko-aktivni" : ""),
        f.nazev + " (" + kolik + ")");
      tl.type = "button";
      tl.setAttribute("aria-pressed", aktivniFiltr === f.kod ? "true" : "false");
      tl.addEventListener("click", function () {
        if (aktivniFiltr === f.kod) return;
        aktivniFiltr = f.kod;
        vykresli(kontejner);
      });
      pruhFiltru.appendChild(tl);
    });
    kontejner.appendChild(pruhFiltru);

    var vyfiltrovane = filtruj(vsechny, aktivniFiltr);

    // Filtr je modulová proměnná — drží se, dokud se stránka tvrdě nenačte,
    // a přežije i přepnutí sekcí. Franta kvůli tomu marně hledal připomínku,
    // kterou nepsal on: zapnutý filtr „Moje“ ji schoval a nic to neřeklo.
    // Když filtr něco skrývá, musí to být vidět — i s cestou ven.
    var skryto = vsechny.length - vyfiltrovane.length;
    if (skryto > 0 && aktivniFiltr !== "vse") {
      var nazevFiltru = "";
      FILTRY.forEach(function (f) { if (f.kod === aktivniFiltr) nazevFiltru = f.nazev; });
      var upozorneni = App.el("div", "filtr-skryva");
      upozorneni.appendChild(document.createTextNode(
        "Filtr „" + nazevFiltru + "“ skrývá " + pocetPripominek(skryto) + "."));
      var odkaz = App.el("button", "odkaz-tlacitko", "Zobrazit vše");
      odkaz.type = "button";
      odkaz.addEventListener("click", function () {
        aktivniFiltr = "vse";
        vykresli(kontejner);
      });
      upozorneni.appendChild(odkaz);
      kontejner.appendChild(upozorneni);
    }

    if (!vyfiltrovane.length) {
      var prazdno = App.el("div", "prazdny-stav");
      prazdno.appendChild(App.el("p", null, vsechny.length
        ? "Tomuto filtru neodpovídá žádná připomínka."
        : "Zatím tu nic není. To je dobře — a kdyby něco přestalo fungovat, napište to sem."));
      kontejner.appendChild(prazdno);
      return;
    }

    // otevřené nahoru, uvnitř nejnovější první
    vyfiltrovane.sort(function (a, b) {
      var poradiStavu = { "nova": 0, "resi-se": 1, "hotovo": 2, "zamitnuto": 3 };
      var rozdil = (poradiStavu[a.stav] || 0) - (poradiStavu[b.stav] || 0);
      if (rozdil) return rozdil;
      return String(b.kdy || "").localeCompare(String(a.kdy || ""));
    });

    var seznam = App.el("div", "karty-mrizka");
    var karty = {};
    vyfiltrovane.forEach(function (p) {
      var karta = kartaPripominky(p);
      karty[p.id] = karta;
      seznam.appendChild(karta);
    });
    kontejner.appendChild(seznam);

    // Doskákat na připomínku, na kterou vedl odkaz z mailu.
    if (zvyraznit && karty[zvyraznit]) {
      var cil = karty[zvyraznit];
      zvyraznit = null;
      cil.classList.add("karta-zvyraznena");
      window.setTimeout(function () {
        try { cil.scrollIntoView({ behavior: "smooth", block: "center" }); }
        catch (e) { cil.scrollIntoView(); }
      }, 60);
    }
  }

  function filtruj(vsechny, kod) {
    if (kod === "vse") return vsechny.slice();
    if (kod === "nejde") return vsechny.filter(function (p) { return p.druh === "nejde"; });
    if (kod === "moje") {
      var ja = mojeOsobaId();
      return vsechny.filter(function (p) { return p.kdo === ja; });
    }
    return vsechny.filter(function (p) {
      return p.stav === "nova" || p.stav === "resi-se";
    });
  }

  App.registrujSekci("pripominky", vykresli);
})();
