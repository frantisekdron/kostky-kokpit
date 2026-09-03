/**
 * app.js — startuje kokpit "Pragerovy kostky" (Emauzy II). Musi byt nacten
 * jako UPLNE POSLEDNI <script> (viz §2.1 kontraktu + dodatek §C.2).
 *
 * Prevezme "pahyl" globalu App (App.registrujSekci + App._registrovaneSekce),
 * ktery je zalozeny inline skriptem v index.html JESTE PRED nactenim
 * js/view-*.js souboru (ty pri svem nacteni volaji App.registrujSekci
 * primo na top-urovni, takze objekt App musi existovat drive, nez se
 * app.js vubec stihne nacist - proto ten pahyl v HTML). Tady se objekt
 * jen doplni o zbytek API.
 *
 * Vystavuje globalni objekt App s temito casti (pouzivaji je VSECHNY
 * sekce view-*.js, jmena a chovani jsou zavazna):
 *   App.data                          { nastaveni, pristupy, lide, plan,
 *                                        navstevy, materialy, aktivita,
 *                                        casosber } — vzdy stejna reference
 *                                        (aktualizuje se na miste, nikdy se
 *                                        nenahrazuje novym objektem). KAZDY
 *                                        klic drzi CELOU obalku souboru
 *                                        presne v tom tvaru, jaky vraci
 *                                        GH.nacti()/GH.zmen()/polling, tedy
 *                                        {verze, zmeneno, zmenil, polozky}
 *                                        (polozkove soubory) nebo {verze,
 *                                        zmeneno, zmenil, data} (nastaveni/
 *                                        pristupy) — NIKDY rozbalene pole/
 *                                        objekt primo. VSECHNY view-*.js
 *                                        soubory ctou/zapisuji App.data
 *                                        VYHRADNE pres tri nasledujici
 *                                        helpery (nikdy primo App.data[x]),
 *                                        to je jednotny a zavazny kontrakt
 *                                        napric celou appkou (viz audit
 *                                        O1-sjednoceni-appdata):
 *   App.polozky(soubor)               -> pole polozek souboru (napr.
 *                                        "navstevy"/"plan"/"materialy"/
 *                                        "lide"/"aktivita"/"casosber").
 *                                        Tolerantni: prijme celou obalku
 *                                        {polozky:[...]}, holé pole, i
 *                                        chybejici/neplatnou hodnotu — v
 *                                        tom pripade vrati [].
 *   App.obsah(soubor)                 -> objekt .data souboru "nastaveni"
 *                                        nebo "pristupy" (napr. {nazev,...}
 *                                        resp. {role,uzivatele}). Tolerantni
 *                                        stejne jako App.polozky — chybejici/
 *                                        neplatna hodnota vrati {}.
 *   App.uloz(soubor, obalka)          -> App.data[soubor] = obalka. Pouziva
 *                                        se po uspesnem GH.zmen(soubor,...),
 *                                        ktere jiz vraci CELOU obalku presne
 *                                        v tomto tvaru — ukladat se ma beze
 *                                        zmeny, nikdy rozbalene pole/objekt.
 *   App.prekresli()                   znovu vykresli aktualni sekci
 *   App.toast(text, druh)             druh: "ok" | "chyba" | "info"
 *   App.modal({nadpis, obsah, akce})  obsah = HTMLElement, akce = [{text,
 *                                        druh, fn}]; vraci {zavri()};
 *                                        zaviratelne Escapem i klikem na
 *                                        pozadi, vraci fokus zpet. Prijima
 *                                        i "titulek" jako alias za "nadpis"
 *                                        (view-plan.js/view-materialy.js to
 *                                        tak pojmenovaly, viz nize).
 *   App.potvrd(otazka)                -> Promise<boolean>. App.potvrdit je
 *                                        alias na totez (view-plan.js/
 *                                        view-materialy.js pouzivaji tento
 *                                        nazev, ostatni sekce App.potvrd
 *                                        presne dle kontraktu).
 *   App.el(tag, tridy, text)          -> HTMLElement (tridy: string i pole)
 *   App.osoba(id)                     -> objekt z App.polozky("lide") nebo null
 *   App.jmenoOsoby(id)                -> jmeno nebo "—"
 *   App.registrujSekci(klic, fn)      fn(kontejner) vykresli sekci
 *   App.jdiNa(hash)                   naviguje na jinou sekci (napr. "#navstevy"),
 *                                        pouziva view-plan.js pro proklik z
 *                                        pripnute navstevy
 *   App.start()                       zavola se po uspesnem prihlaseni:
 *                                        nacte data, spusti router, spusti
 *                                        polling
 *   App.nastavSync(stav, text)        drobne navic (neni v kontraktu
 *                                        vyslovne pojmenovane): rucni
 *                                        ovladani hlavickoveho indikatoru
 *                                        synchronizace pro pripad, ze by ho
 *                                        chtel pouzit i jiny soubor
 *
 * Dale: router nad location.hash (#prehled/#navstevy/#plan/#casosber/
 * #materialy/#emauzy/#lide/#kos/#sprava/#naklady — #casosber a #emauzy
 * pridava dodatek §C.2; #naklady je sekce jen pro superadmina, viz
 * PRAVO_SEKCE nize a js/view-naklady.js), wiring prihlasovaciho formulare
 * na Auth.prihlas(), wiring
 * odhlasovaciho tlacitka na Auth.odhlas(), hlavickovy indikator
 * synchronizace a globalni odchytavani chyb (window.onerror,
 * unhandledrejection -> App.toast).
 *
 * DEMO REZIM (KONTRAKT_DODATEK.md §E): kdyz je window.DEMO === true
 * (nastavuje demo.html) nebo je index.html otevreny s "?demo=1" a je
 * k dispozici konstanta DEMO_DATA (js/demo-data.js — index.html ji sam
 * nenacita, takze se v tomhle pripade dotahne dodatecne), app.js preskoci
 * prihlaseni, prihlasi fiktivniho super admina, naplni App.data HLUBOKOU
 * kopii DEMO_DATA a vlozi nad hlavicku oranzovy pruh s prepinacem roli
 * (super admin / admin / editor / ctenar) a tlacitkem "Vymazat demo data".
 * Zapisy v demu obsluhuje js/gh.js (pamet + localStorage "kostky_demo"),
 * na sit se nesahne. V ostrem provozu (index.html bez "?demo=1") se z demo
 * bloku nespusti nic — viz sekce "DEMO REZIM" na konci souboru.
 *
 * NEIMPLEMENTUJE obsah jednotlivych sekci - ten registruji az view-*.js
 * pres App.registrujSekci. Nezaregistrovana sekce vypise do kontejneru
 * "Sekce se nenačetla."
 */

(function () {
  "use strict";

  // ------------------------------------------------------------------
  // Navazani na existujici pahyl App (viz komentar nahore) + pojistka pro
  // pripad, ze by pahyl v HTML chybel.
  // ------------------------------------------------------------------

  var App = (window.App = window.App || {});

  if (typeof App.registrujSekci !== "function") {
    App._registrovaneSekce = App._registrovaneSekce || {};
    App.registrujSekci = function (klic, fn) {
      App._registrovaneSekce[klic] = fn;
    };
  }
  App._registrovaneSekce = App._registrovaneSekce || {};

  // ------------------------------------------------------------------
  // App.data — vzdy stejna reference, plni se v nactiData()/naZmenuSouboru().
  // Kazdy klic drzi CELOU obalku {verze, zmeneno, zmenil, polozky|data} —
  // presne tvar, jaky vraci GH.nacti()/GH.zmen()/polling (viz komentar
  // App.data vyse). Vychozi prazdna obalka pred prvnim nactenim dat.
  // ------------------------------------------------------------------

  function prazdnaObalkaPolozek() {
    return { verze: 0, zmeneno: null, zmenil: null, polozky: [] };
  }

  function prazdnaObalkaDat(zaklad) {
    return { verze: 0, zmeneno: null, zmenil: null, data: zaklad || {} };
  }

  App.data = App.data || {};
  App.data.nastaveni = App.data.nastaveni || prazdnaObalkaDat({});
  App.data.pristupy = App.data.pristupy || prazdnaObalkaDat({ role: {}, uzivatele: {} });
  App.data.lide = App.data.lide || prazdnaObalkaPolozek();
  App.data.plan = App.data.plan || prazdnaObalkaPolozek();
  App.data.navstevy = App.data.navstevy || prazdnaObalkaPolozek();
  App.data.materialy = App.data.materialy || prazdnaObalkaPolozek();
  App.data.aktivita = App.data.aktivita || prazdnaObalkaPolozek();
  App.data.casosber = App.data.casosber || prazdnaObalkaPolozek(); // dodatek §A
  App.data.pripominky = App.data.pripominky || prazdnaObalkaPolozek(); // sekce Připomínky
  // Harmonogram PORR je JEJICH interní dokument — žije v privátním datovém
  // repu, ne v appce. Ve veřejném repu nesmí být (audit 30. 8. 2026).
  App.data.harmonogram = App.data.harmonogram || { verze: 0, data: {} };
  // Seznam snímků z náletu (souřadnice, výšky) — taky data, ne appka.
  App.data.nalet = App.data.nalet || { verze: 0, data: { teren_m: 260, polozky: [] } };
  // Náklady na provoz — obálka nese místo "polozky" jediný klíč "sifrovano"
  // (obsah je zašifrovaný vlastním heslem, viz js/view-naklady.js). Soubor
  // v repu klidně ještě neexistuje — pak je "sifrovano" null a sekce nabídne
  // založení. App.polozky("naklady") se schválně nepoužívá: rozšifrovaná data
  // nikdy neleží v App.data, žijí jen v paměti té sekce.
  App.data.naklady = App.data.naklady || { verze: 0, zmeneno: null, zmenil: null, sifrovano: null };

  // ------------------------------------------------------------------
  // App.polozky / App.obsah / App.uloz — JEDINY spravny zpusob, jak vsechny
  // view-*.js ctou a zapisuji App.data (viz komentar u App.data nahore).
  // Kanonicky tvar App.data[soubor] je VZDY cela obalka {verze, zmeneno,
  // zmenil, polozky} nebo {verze, zmeneno, zmenil, data}. Ctecí helpery
  // jsou zamerne tolerantni (obalka i uz rozbalene pole/objekt i chybejici
  // hodnota), aby nikdy nespadly, i kdyby nekde v appce zustalo neco
  // nerozbalene — ale ZAPIS (App.uloz) uklada VZDY presne to, co dostane,
  // beze zmeny tvaru, protoze GH.zmen() uz vraci celou obalku.
  // ------------------------------------------------------------------

  App.polozky = function (soubor) {
    var obal = App.data[soubor];
    if (Array.isArray(obal)) return obal; // uz rozbalene pole (pojistka)
    if (obal && Array.isArray(obal.polozky)) return obal.polozky;
    return [];
  };

  App.obsah = function (soubor) {
    var obal = App.data[soubor];
    if (!obal || typeof obal !== "object") return {};
    if (obal.data && typeof obal.data === "object") return obal.data;
    // uz rozbaleny holy objekt bez obalky (pojistka) — pozna se podle toho,
    // ze nema znaky obalky (verze/polozky); jinak jde o neplatnou/prazdnou
    // obalku a vraci se prazdny objekt.
    if (!("verze" in obal) && !("polozky" in obal)) return obal;
    return {};
  };

  App.uloz = function (soubor, obalka) {
    if (!soubor || !obalka) return;
    App.data[soubor] = obalka;
  };

  // ------------------------------------------------------------------
  // Male pomocne funkce
  // ------------------------------------------------------------------

  function dvojcislo(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  // ------------------------------------------------------------------
  // App.el — rychla tvorba prvku. tridy = string ("a b") nebo pole. text
  // se vklada VZDY pres textContent (zadny innerHTML, viz §11 kontraktu).
  // ------------------------------------------------------------------

  App.el = function (tag, tridy, text) {
    var el = document.createElement(tag);
    if (tridy) {
      var seznam = Array.isArray(tridy) ? tridy : String(tridy).split(/\s+/);
      seznam.forEach(function (t) {
        if (t) el.classList.add(t);
      });
    }
    if (text !== undefined && text !== null) {
      el.textContent = text;
    }
    return el;
  };

  // ------------------------------------------------------------------
  // App.osoba / App.jmenoOsoby
  // ------------------------------------------------------------------

  App.osoba = function (id) {
    if (!id) return null;
    var polozky = App.polozky("lide"); // vzdy pres spolecny helper, nikdy App.data primo
    for (var i = 0; i < polozky.length; i++) {
      if (polozky[i] && polozky[i].id === id) return polozky[i];
    }
    // Pojistka pro starsi zaznamy: nektere sekce driv zapisovaly do "kdo"
    // prihlasovaci id ("honza") misto id osoby ("os-06"). At se u nich
    // v kosi a v aktivite ukaze jmeno, ne pomlcka.
    for (var j = 0; j < polozky.length; j++) {
      if (polozky[j] && polozky[j].ma_pristup === id) return polozky[j];
    }
    return null;
  };

  // ------------------------------------------------------------------
  // App.jsemZaFD() — je prihlaseny clovek za nas (Frantisek Dron), nebo
  // za PORR ci Metrostav? Ridi to, jestli se ukazou INTERNI obchodni udaje
  // (rozdil rozsahu smlouvy, cerpani, ceny). Do kokpitu chodi i lide
  // investora a zhotovitele — nase vyjednavaci pozice pred nimi nema co
  // delat. Neni to bezpecnostni hranice, je to slusnost a obchodni rozum:
  // kdo ma zapisovy token, dostane se ke vsemu.
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // Vyska hlavicky do CSS promenne --vyska-hlavicky. Desktopova navigace se
  // o ni prilepuje (position: sticky; top). Meni se podle toho, jestli je
  // videt demo pruh a jestli se hlavicka zalomi na vic radku, takze ji nejde
  // napsat natvrdo do CSS.
  // ------------------------------------------------------------------

  function hlidejVyskuHlavicky() {
    var hlavicka = document.querySelector(".hlavicka");
    if (!hlavicka) return;

    function zmer() {
      var v = Math.round(hlavicka.getBoundingClientRect().height);
      if (v > 0) document.documentElement.style.setProperty("--vyska-hlavicky", v + "px");
    }

    zmer();
    if (typeof window.ResizeObserver === "function") {
      new window.ResizeObserver(zmer).observe(hlavicka);
    } else {
      window.addEventListener("resize", zmer);
    }
    // Po prihlaseni a po prepnuti sekce se hlavicka muze zalomit jinak.
    window.addEventListener("load", zmer);
  }

  App.hlidejVyskuHlavicky = hlidejVyskuHlavicky;

  App.jsemZaFD = function () {
    var ja = Auth.ja;
    if (!ja || !ja.osoba_id) return false;
    var osoba = App.osoba(ja.osoba_id);
    return !!(osoba && osoba.strana === "FD");
  };

  App.jmenoOsoby = function (id) {
    var osoba = App.osoba(id);
    return osoba && osoba.jmeno ? osoba.jmeno : "—";
  };

  // ------------------------------------------------------------------
  // App.toast
  // ------------------------------------------------------------------

  function odeberToast(el) {
    if (!el || !el.parentNode) return;
    if (el._casovac) window.clearTimeout(el._casovac);
    el.classList.add("toast-mizi");
    window.setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 200);
  }

  App.toast = function (text, druh) {
    druh = druh === "ok" || druh === "chyba" || druh === "info" ? druh : "info";
    var kontejner = document.getElementById("toasty");
    if (!kontejner) return null;
    var el = App.el("div", ["toast", "toast-" + druh]);
    el.setAttribute("role", druh === "chyba" ? "alert" : "status");
    var textEl = App.el("span", "toast-text", text === undefined || text === null ? "" : String(text));
    var btn = App.el("button", "toast-zavrit", "×");
    btn.type = "button";
    btn.setAttribute("aria-label", "Zavřít oznámení");
    btn.addEventListener("click", function () {
      odeberToast(el);
    });
    el.appendChild(textEl);
    el.appendChild(btn);
    kontejner.appendChild(el);
    var doba = druh === "chyba" ? 8000 : 4500;
    el._casovac = window.setTimeout(function () {
      odeberToast(el);
    }, doba);
    return el;
  };

  // ------------------------------------------------------------------
  // App.modal — zaviratelny Escapem i klikem na pozadi, vraci fokus zpet.
  // Volitelne nastaveni.naZavreni() se zavola pri KAZDEM zavreni (tlacitko,
  // Escape, klik na pozadi, volani .zavri()) - vyuziva to App.potvrd nize.
  // ------------------------------------------------------------------

  App.modal = function (nastaveni) {
    nastaveni = nastaveni || {};
    var kontejner = document.getElementById("modal-kontejner");
    var predchoziFokus = document.activeElement;
    var zavreno = false;

    // "titulek" je alias za "nadpis" — view-plan.js a view-materialy.js byly
    // napsane drive, nez app.js v repu existoval, a pojmenovaly to pole
    // takto (viz POZNAMKY_D-plan-materialy.md).
    var textNadpisu = nastaveni.nadpis || nastaveni.titulek || "";

    var pozadi = App.el("div", "modal-pozadi");
    var okno = App.el("div", "modal-okno");
    okno.setAttribute("role", "dialog");
    okno.setAttribute("aria-modal", "true");
    if (textNadpisu) okno.setAttribute("aria-label", textNadpisu);

    var hlavicka = App.el("div", "modal-hlavicka");
    var nadpisEl = App.el("h2", "modal-nadpis", textNadpisu);
    var btnZavrit = App.el("button", "modal-zavrit", "×");
    btnZavrit.type = "button";
    btnZavrit.setAttribute("aria-label", "Zavřít");
    hlavicka.appendChild(nadpisEl);
    hlavicka.appendChild(btnZavrit);

    var telo = App.el("div", "modal-telo");
    if (nastaveni.obsah instanceof Node) {
      telo.appendChild(nastaveni.obsah);
    }

    var akce = Array.isArray(nastaveni.akce) ? nastaveni.akce : [];
    var paticka = null;
    if (akce.length) {
      paticka = App.el("div", "modal-paticka");
      akce.forEach(function (a) {
        var trida = a && a.druh ? "btn-" + a.druh : "btn-sekundarni";
        var btn = App.el("button", ["btn", trida], (a && a.text) || "");
        btn.type = "button";
        btn.addEventListener("click", function () {
          if (a && typeof a.fn === "function") a.fn();
        });
        paticka.appendChild(btn);
      });
    }

    okno.appendChild(hlavicka);
    okno.appendChild(telo);
    if (paticka) okno.appendChild(paticka);
    pozadi.appendChild(okno);

    function naEscape(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        zavri();
      }
    }

    function zavri() {
      if (zavreno) return;
      zavreno = true;
      document.removeEventListener("keydown", naEscape, true);
      if (pozadi.parentNode) pozadi.parentNode.removeChild(pozadi);
      if (kontejner && !kontejner.hasChildNodes()) kontejner.hidden = true;
      if (predchoziFokus && typeof predchoziFokus.focus === "function") {
        predchoziFokus.focus();
      }
      if (typeof nastaveni.naZavreni === "function") {
        nastaveni.naZavreni();
      }
    }

    pozadi.addEventListener("click", function (e) {
      if (e.target === pozadi) zavri();
    });
    btnZavrit.addEventListener("click", zavri);
    document.addEventListener("keydown", naEscape, true);

    // Kam modal vlozit. Detail navstevy se otevira jako nativni <dialog>
    // pres showModal(), takze zije v "top layer" NAD vsemi z-indexy — modal
    // vlozeny do #modal-kontejner (z-index 100) by pod nim uplne zmizel
    // (potvrzeni smazani by neslo videt ani kliknout). Kdyz je tedy nejaky
    // <dialog> otevreny, vlozime se dovnitr nej: .modal-pozadi je position
    // fixed, takze prekryje celou obrazovku at visi kdekoli.
    var otevrenyDialog = document.querySelector("dialog[open]");
    var hostitel = otevrenyDialog || kontejner;
    if (hostitel === kontejner && kontejner) {
      kontejner.hidden = false;
    }
    if (hostitel) {
      hostitel.appendChild(pozadi);
    }

    var fokusovatelny = okno.querySelector("input, select, textarea, button, a[href], [tabindex]");
    (fokusovatelny || btnZavrit).focus();

    return { zavri: zavri };
  };

  // ------------------------------------------------------------------
  // App.potvrd — potvrzovaci modal. Zavreni jakymkoli zpusobem bez kliku
  // na "Potvrdit" se pocita jako zamitnuti (resolve(false)).
  // ------------------------------------------------------------------

  App.potvrd = function (otazka) {
    return new Promise(function (resolve) {
      var vyreseno = false;
      function vyres(hodnota) {
        if (vyreseno) return;
        vyreseno = true;
        resolve(hodnota);
      }
      var obsah = App.el("p", null, otazka || "Opravdu?");
      var modal = App.modal({
        nadpis: "Potvrzení",
        obsah: obsah,
        naZavreni: function () {
          vyres(false);
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
            text: "Potvrdit",
            druh: "primarni",
            fn: function () {
              vyres(true);
              modal.zavri();
            }
          }
        ]
      });
    });
  };

  // Alias — view-plan.js a view-materialy.js pouzivaji nazev "potvrdit"
  // (napsane drive, nez byl znamy presny kontraktovy nazev App.potvrd).
  App.potvrdit = App.potvrd;

  // ------------------------------------------------------------------
  // Indikator synchronizace v hlavicce ("Synchronizováno HH:MM" /
  // "Ukládám…" / "Chyba"). Cteni (nactiData/polling) volaji nastavSync
  // primo odsud; pro zapisy (GH.zmen) se GH.zmen jednou "obali" (viz
  // zapniIndikatorUkladani), aby to nemusel resit kazdy view-*.js zvlast.
  // ------------------------------------------------------------------

  function nastavSync(stav, textOverride) {
    var tecka = document.getElementById("sync-tecka");
    var text = document.getElementById("sync-text");
    if (!tecka || !text) return;
    tecka.classList.remove("sync-ok", "sync-ukladam", "sync-chyba");
    if (stav === "ukladam") {
      tecka.classList.add("sync-ukladam");
      text.textContent = textOverride || "Ukládám…";
    } else if (stav === "chyba") {
      tecka.classList.add("sync-chyba");
      text.textContent = textOverride || "Chyba";
    } else {
      tecka.classList.add("sync-ok");
      var ted = new Date();
      text.textContent = "Synchronizováno " + dvojcislo(ted.getHours()) + ":" + dvojcislo(ted.getMinutes());
    }
  }

  App.nastavSync = nastavSync;

  function zapniIndikatorUkladani() {
    if (!window.GH || typeof GH.zmen !== "function" || GH._zmenObalenoAppem) return;
    var puvodniZmen = GH.zmen;
    GH.zmen = function (soubor, fn, popis) {
      nastavSync("ukladam");
      return puvodniZmen(soubor, fn, popis).then(
        function (vysledek) {
          nastavSync("ok");
          return vysledek;
        },
        function (chyba) {
          nastavSync("chyba");
          throw chyba;
        }
      );
    };
    GH._zmenObalenoAppem = true;
  }

  // ------------------------------------------------------------------
  // Nacitani dat: GH.nactiVse() vraci { [soubor]: {data, etag, sha} }, kde
  // "data" je CELA obalka {verze, zmeneno, zmenil, polozky|data} — presne
  // to, co se uklada do App.data[soubor] BEZE ZMENY (viz komentar u App.data
  // nahore — shoduje se s tim, co uz predpokladaji hotove view-*.js soubory).
  // ------------------------------------------------------------------

  function aktualizujNazevProjektu() {
    var el = document.getElementById("hlavicka-nazev-projektu");
    var data = App.obsah("nastaveni"); // vzdy pres spolecny helper, nikdy App.data primo
    if (el && data.nazev) {
      el.textContent = data.nazev;
    }
  }

  function nactiData() {
    if (!window.GH || typeof GH.nactiVse !== "function") {
      return Promise.reject(new Error("Datová vrstva (GH) není načtená."));
    }
    return GH.nactiVse().catch(function (chyba) {
      // Pozor: App.chybejici se driv plnilo jen na uspesne vetvi. Kdyz
      // nactiVse odmitlo (cokoli jineho nez 404), .then se nespustil,
      // App.chybejici zustalo undefined a vystraha o nenactenych datech
      // MLCELA prave u poruch, ktere se samy nespravi. Overeno reprodukci.
      App.chybejici = ["všechna data"];
      throw chyba;
    }).then(function (vysledky) {
      // gh.js si chybejici soubory odklada do __chybejici. Driv to nikdo
      // necetl, takze se sekce s nenactenymi daty tvarila jako PRAZDNA —
      // vypadalo to, ze zaznamy zmizely, i kdyz v repu poradne byly.
      App.chybejici = Array.isArray(vysledky.__chybejici) ? vysledky.__chybejici : [];
      Object.keys(vysledky).forEach(function (klic) {
        var zaznam = vysledky[klic];
        if (zaznam && zaznam.data) {
          App.uloz(klic, zaznam.data); // cela obalka beze zmeny tvaru
        }
      });
      if (window.Auth && typeof Auth.nactiPrava === "function") {
        Auth.nactiPrava(App.data.pristupy);
      }
      aktualizujNazevProjektu();
      nastavHlavicku();
      nastavViditelnostSekci();
      ohlasZmenuRole();
    });
  }

  // Callback pro GH.spustPolling: gh.js ho vola jako cb(soubor, data) pro
  // KAZDY zmeneny soubor zvlast (data = cela cerstva obalka toho souboru,
  // ulozi se do App.data[soubor] rovnou beze zmeny).
  // gh.js hlasi, u kterych souboru posledni polling selhal. Bez toho se
  // appka tvarila synchronizovane i nad daty starymi klidne hodinu.
  function naChybuPollingu(chybejici) {
    App.chybejici = (chybejici && chybejici.length) ? chybejici.slice() : [];
    if (App.chybejici.length) {
      nastavSync("chyba", "Data nejsou aktuální");
    } else {
      nastavSync("ok");
    }
    App.prekresli();
  }

  function naZmenuSouboru(soubor, obal) {
    if (!obal) return;
    App.uloz(soubor, obal); // cela obalka beze zmeny tvaru
    if (soubor === "pristupy" && window.Auth && typeof Auth.nactiPrava === "function") {
      Auth.nactiPrava(App.data.pristupy);
      nastavHlavicku();
      nastavViditelnostSekci();
      ohlasZmenuRole();
    }
    if (soubor === "nastaveni") {
      aktualizujNazevProjektu();
    }
    if ((App.chybejici || []).length) {
      nastavSync("chyba", "Data nejsou aktuální");
    } else {
      nastavSync("ok");
    }
    App.prekresli();
  }

  // ------------------------------------------------------------------
  // Router nad location.hash
  // ------------------------------------------------------------------

  var PLATNE_SEKCE = ["prehled", "navstevy", "plan", "casosber", "materialy", "emauzy",
    "pripominky", "lide", "kos", "sprava", "naklady"];
  var aktualniSekce = null;
  var routerZapnuty = false;

  // Hash umí i „#pripominky/pri-001“ — odkaz z upozorňovacího mailu tak vede
  // rovnou na konkrétní záznam, ne jen na sekci (kde ho výchozí filtr schová).
  function rozlozHash() {
    var cely = (window.location.hash || "").replace("#", "");
    var lomitko = cely.indexOf("/");
    if (lomitko === -1) return { sekce: cely, parametr: "" };
    return { sekce: cely.slice(0, lomitko), parametr: cely.slice(lomitko + 1) };
  }

  function ziskejSekciZHashe() {
    var klic = rozlozHash().sekce;
    return PLATNE_SEKCE.indexOf(klic) !== -1 ? klic : "prehled";
  }

  // Co je v hashi za lomítkem (id záznamu). Sekce si to přečte při vykreslení.
  App.parametrHashe = function () {
    return decodeURIComponent(rozlozHash().parametr || "");
  };

  // Sekce skryvane podle prava (§9.7). Klic = sekce, hodnota = funkce, ktera
  // rekne, jestli ji prihlaseny clovek smi videt. Co tu neni, vidi kazdy.
  // Hlida se na dvou mistech naraz a obe jsou nutna:
  //   - nastavViditelnostSekci() schova odkaz v navigaci,
  //   - smerujNaSekci() odmitne i rucne napsany hash (#naklady) a odveze
  //     cloveka na Prehled.
  // POZOR: u nakladu je tohle jen slusnost, ne ochrana. Zapisovy token do
  // privatniho repa ma cely tym vcetne PORR a Metrostavu, takze si obsah
  // muze precist primo v repu. Skutecnou ochranou je AZ to, ze je obsah
  // data/naklady.json zasifrovany vlastnim heslem (js/view-naklady.js).
  var PRAVO_SEKCE = {
    sprava: function () {
      return !!(window.Auth && typeof Auth.can === "function" && Auth.can("prava.upravit"));
    },
    // Naklady a marze vidi VYHRADNE superadmin — ne "kdo smi upravovat prava",
    // ale primo role. Admin z PORR ma prava.upravit vypnute, ale kdyby ho
    // nekdo povysil, na naklady se tim dostat nesmi.
    naklady: function () {
      return !!(window.Auth && Auth.role === "superadmin");
    }
  };

  function maPravoNaSekci(klic) {
    var test = PRAVO_SEKCE[klic];
    if (typeof test !== "function") return true;
    return test();
  }

  function oznacAktivniOdkaz(klic) {
    var odkazy = document.querySelectorAll("#navigace .nav-odkaz");
    odkazy.forEach(function (odkaz) {
      var aktivni = odkaz.getAttribute("data-sekce") === klic;
      odkaz.classList.toggle("nav-odkaz-aktivni", aktivni);
      if (aktivni) {
        odkaz.setAttribute("aria-current", "page");
      } else {
        odkaz.removeAttribute("aria-current");
      }
    });
  }

  // Ktery datovy soubor sekce potrebuje, aby se dalo poznat, ze je prazdna
  // kvuli chybe, a ne proto, ze v ni nic neni. Kos a Prehled ctou vic souboru.
  var SOUBOR_SEKCE = {
    navstevy: "navstevy", plan: "plan", casosber: "casosber",
    materialy: "materialy", emauzy: "materialy",
    pripominky: "pripominky", lide: "lide", sprava: "pristupy",
    naklady: "naklady"
  };

  // Vlastni misto NAD #obsah. Do #obsah to patrit nemuze: sekce si ho pri
  // vykresleni promazavaji, takze by hlasku smazaly hned po vlozeni.
  function misroProVystrahu() {
    var uz = document.getElementById("vystraha-data");
    if (uz) return uz;
    var obsah = document.getElementById("obsah");
    if (!obsah || !obsah.parentNode) return null;
    var box = document.createElement("div");
    box.id = "vystraha-data";
    box.setAttribute("role", "status");
    obsah.parentNode.insertBefore(box, obsah);
    return box;
  }

  function zobrazVystrahu(klic) {
    var box = misroProVystrahu();
    if (!box) return;
    while (box.firstChild) box.removeChild(box.firstChild);
    var karta = hlaskaONactenych(klic);
    if (karta) box.appendChild(karta);
  }

  function hlaskaONactenych(klic) {
    var chybejici = App.chybejici || [];
    if (!chybejici.length) return null;
    var soubor = SOUBOR_SEKCE[klic];
    // "všechna data" = nactiVse odmitlo, nevime u ktereho souboru -> hlasime vsude
    var vsude = chybejici.indexOf("všechna data") !== -1;
    var tyka = (vsude || klic === "prehled" || klic === "kos")
      ? chybejici.slice()
      : (chybejici.indexOf(soubor) !== -1 ? [soubor] : []);
    if (!tyka.length) return null;

    var karta = App.el("div", "karta-upozorneni");
    var text = App.el("div");
    text.appendChild(App.el("strong", null, "Nevidíte aktuální data."));
    text.appendChild(App.el("p", "karta-meta",
      "Nepodařilo se stáhnout: " + tyka.join(", ") + ". Co je níž, může být " +
      "zastaralé nebo neúplné. Nic se neztratilo — záznamy jsou uložené na " +
      "serveru, jen je teď nevidíme. Než se načtení povede, sem raději nezapisujte."));
    var tlacitko = App.el("button", "tlacitko tlacitko-vedlejsi", "Načíst znovu");
    tlacitko.type = "button";
    tlacitko.addEventListener("click", function () {
      tlacitko.disabled = true;
      tlacitko.textContent = "Načítám…";
      nactiData()
        .then(function () {
          App.toast((App.chybejici || []).length
            ? "Některá data se pořád nenačetla." : "Data načtena.",
            (App.chybejici || []).length ? "chyba" : "ok");
          App.prekresli();
        })
        .catch(function () {
          tlacitko.disabled = false;
          tlacitko.textContent = "Načíst znovu";
          App.toast("Načtení se nepovedlo.", "chyba");
        });
    });
    text.appendChild(tlacitko);
    karta.appendChild(text);
    return karta;
  }

  function renderObsah(klic, presunFokus) {
    var kontejner = document.getElementById("obsah");
    if (!kontejner) return;
    while (kontejner.firstChild) kontejner.removeChild(kontejner.firstChild);
    zobrazVystrahu(klic);
    var fn = App._registrovaneSekce && App._registrovaneSekce[klic];
    if (typeof fn === "function") {
      try {
        fn(kontejner);
      } catch (chyba) {
        console.error('Chyba při vykreslování sekce "' + klic + '":', chyba);
        while (kontejner.firstChild) kontejner.removeChild(kontejner.firstChild);
        zobrazVystrahu(klic);
        kontejner.appendChild(App.el("p", null, "Sekce se nenačetla."));
        App.toast("Sekci se nepodařilo vykreslit.", "chyba");
      }
    } else {
      kontejner.textContent = "Sekce se nenačetla.";
    }
    if (presunFokus) {
      try { kontejner.focus({ preventScroll: true }); }
      catch (e) { /* starší prohlížeče preventScroll neznají */ }
    }
  }

  function smerujNaSekci() {
    var klic = ziskejSekciZHashe();
    if (!maPravoNaSekci(klic)) {
      if (window.location.hash !== "#prehled") {
        window.location.hash = "#prehled"; // vyvola dalsi hashchange -> dorenderuje
        return;
      }
      klic = "prehled";
    }
    aktualniSekce = klic;
    oznacAktivniOdkaz(klic);
    renderObsah(klic, true);
  }

  App.prekresli = function () {
    renderObsah(aktualniSekce || ziskejSekciZHashe(), false);
  };

  function zapniRouter() {
    if (routerZapnuty) return;
    routerZapnuty = true;
    window.addEventListener("hashchange", smerujNaSekci);
  }

  // Naviguje na jinou sekci, napr. App.jdiNa("#navstevy") — pouziva
  // view-plan.js pro proklik z pripnute navstevy. Prijima hash s "#" i bez.
  App.jdiNa = function (hash) {
    if (!hash) return;
    window.location.hash = hash.charAt(0) === "#" ? hash : "#" + hash;
  };

  // ------------------------------------------------------------------
  // Hlavicka: jmeno + role prihlaseneho, viditelnost odkazu na Spravu
  // ------------------------------------------------------------------

  var NAZVY_ROLI_ZAKLAD = {
    superadmin: "Super admin",
    admin: "Admin",
    editor: "Editor",
    ctenar: "Čtenář"
  };

  function nazevRole(kod) {
    var role = App.obsah("pristupy").role; // vzdy pres spolecny helper, nikdy App.data primo
    if (role && role[kod] && role[kod].nazev) return role[kod].nazev;
    return NAZVY_ROLI_ZAKLAD[kod] || kod || "";
  }

  function nastavHlavicku() {
    var jmenoEl = document.getElementById("uzivatel-jmeno");
    var roleEl = document.getElementById("uzivatel-role");
    if (jmenoEl && window.Auth && Auth.ja) {
      jmenoEl.textContent = Auth.ja.jmeno || Auth.ja.id || "";
    }
    if (roleEl && window.Auth && Auth.role) {
      roleEl.textContent = nazevRole(Auth.role);
    }
  }

  // Schova v navigaci odkazy na sekce, na ktere prihlaseny clovek nema pravo
  // (viz PRAVO_SEKCE vyse). Driv to umela jen jedna sekce ("sprava") a jmenovala
  // se podle ni; ted projde vsechny, at se na dalsi sekci nezapomene.
  var posluchaciRole = [];

  // Sekce si sem zaregistruje, co má udělat při změně role. Volá se i tehdy,
  // když sekce zrovna není na obrazovce — proto to nejde řešit uvnitř
  // vykresli(). Sekce Náklady tak zahodí heslo z paměti, jakmile role klesne.
  App.naZmenuRole = function (fn) {
    if (typeof fn === "function") posluchaciRole.push(fn);
  };

  function ohlasZmenuRole() {
    var role = (window.Auth && Auth.role) || null;
    posluchaciRole.forEach(function (fn) {
      try { fn(role); }
      catch (chyba) { console.warn("Posluchač změny role selhal:", chyba); }
    });
  }

  function nastavViditelnostSekci() {
    Object.keys(PRAVO_SEKCE).forEach(function (klic) {
      var odkaz = document.querySelector('#navigace .nav-odkaz[data-sekce="' + klic + '"]');
      if (!odkaz) return;
      odkaz.hidden = !maPravoNaSekci(klic);
    });
  }

  // ------------------------------------------------------------------
  // App.start — po uspesnem prihlaseni: nacte data, spusti router, spusti
  // polling. Zamerne nikdy neodmita (chyba nacteni se resi toastem uvnitr),
  // aby appka po prihlaseni vzdy prisla do interaktivniho stavu.
  // ------------------------------------------------------------------

  App.start = function () {
    nastavSync("ukladam", "Načítám…");
    hlidejVyskuHlavicky();
    return nactiData()
      .then(function () {
        nastavSync("ok");
      })
      .catch(function (chyba) {
        console.error("Načtení dat selhalo:", chyba);
        nastavSync("chyba");
        var zprava = chyba && chyba.message ? chyba.message : "Nepodařilo se načíst data z GitHubu.";
        App.toast(zprava, "chyba");
      })
      .then(function () {
        zapniRouter();
        smerujNaSekci();
        if (window.GH && typeof GH.spustPolling === "function") {
          GH.spustPolling(naZmenuSouboru, naChybuPollingu);
        }
      });
  };

  // ------------------------------------------------------------------
  // Prihlasovaci obrazovka: naplneni vyberu osob, predvyplneni posledni
  // pouzite osoby (az po Auth._startovniKontrola, viz POZNAMKY_B-krypto-
  // auth.md bod 8 — jinak hrozi zavod s asynchronni kontrolou otisku),
  // odeslani formulare -> Auth.prihlas() -> GH.init() -> App.start().
  // ------------------------------------------------------------------

  // Když v repu ještě není config.js (typicky hned po prvním nasazení, než
  // Franta spustí scripts/nastav_pristup.py), nemá se komu přihlásit.
  // Místo mrtvého formuláře řekneme rovnou, co je potřeba, a nabídneme demo —
  // jinak to vypadá, že je appka rozbitá.
  function ukazChybejiciKonfiguraci() {
    var formular = document.getElementById("login-form");
    if (!formular) return;
    var box = App.el("div", "login-chybi-config");
    box.appendChild(App.el("h3", null, "Kokpit ještě není nastavený"));
    box.appendChild(App.el("p", null,
      "Chybí soubor config.js s přístupy. Vyrobí ho skript nastav_pristup.py " +
      "z privátního repozitáře kostky-data — postup je v README tamtéž."));
    box.appendChild(App.el("p", null,
      "Pokud jsi sem přišel s tím, že ti někdo posílal přístup: dej mu vědět, " +
      "že kokpit ještě není zprovozněný."));
    // Necháme login kartu, jen jí vyměníme obsah — vzhled zůstane.
    var hlavicka = formular.querySelector(".login-hlavicka");
    while (formular.lastChild && formular.lastChild !== hlavicka) {
      formular.removeChild(formular.lastChild);
    }
    formular.appendChild(box);
  }

  function naplnVyberOsob() {
    var vyber = document.getElementById("login-osoba");
    if (!vyber) return;
    if (!window.KONFIG || !Array.isArray(KONFIG.osoby) || !KONFIG.osoby.length) {
      ukazChybejiciKonfiguraci();
      return;
    }
    while (vyber.firstChild) vyber.removeChild(vyber.firstChild);
    var osoby = window.Auth && typeof Auth.seznamOsob === "function" ? Auth.seznamOsob() : [];
    var prazdna = document.createElement("option");
    prazdna.value = "";
    prazdna.textContent = osoby.length ? "Vyber osobu…" : "Seznam osob se nenačetl";
    prazdna.disabled = true;
    prazdna.selected = true;
    vyber.appendChild(prazdna);
    osoby.forEach(function (osoba) {
      var option = document.createElement("option");
      option.value = osoba.id;
      option.textContent = osoba.jmeno;
      vyber.appendChild(option);
    });
  }

  function predvyplnPosledniOsobu() {
    var surova;
    try {
      surova = window.localStorage.getItem("kostky_login");
    } catch (chyba) {
      return;
    }
    if (!surova) return;
    var ulozene;
    try {
      ulozene = JSON.parse(surova);
    } catch (chyba) {
      return;
    }
    var vyber = document.getElementById("login-osoba");
    if (!ulozene || !ulozene.id || !vyber) return;
    var existuje = false;
    for (var i = 0; i < vyber.options.length; i++) {
      if (vyber.options[i].value === ulozene.id) {
        existuje = true;
        break;
      }
    }
    if (existuje) {
      vyber.value = ulozene.id;
      var poleHeslo = document.getElementById("login-heslo");
      if (poleHeslo) poleHeslo.focus();
    }
  }

  function pripravLogin() {
    naplnVyberOsob();
    var cekani = (window.Auth && Auth._startovniKontrola) || Promise.resolve();
    Promise.resolve(cekani)
      .then(predvyplnPosledniOsobu)
      .catch(function () {
        /* kontrola ulozeneho prihlaseni selhala - proste nepredvyplnime */
      });
  }

  function zobrazChybuLoginu(text) {
    var el = document.getElementById("login-chyba");
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
  }

  function skryjChybuLoginu() {
    var el = document.getElementById("login-chyba");
    if (!el) return;
    el.hidden = true;
    el.textContent = "";
  }

  function nastavNacitaniTlacitka(nacita) {
    var tlacitko = document.getElementById("login-tlacitko");
    if (!tlacitko) return;
    tlacitko.disabled = nacita;
    tlacitko.textContent = nacita ? "Přihlašuji…" : "Přihlásit";
  }

  function zobrazAplikaci() {
    var login = document.getElementById("obrazovka-login");
    var layout = document.getElementById("layout");
    if (login) login.hidden = true;
    if (layout) layout.hidden = false;
    nastavHlavicku();
    nastavViditelnostSekci();
  }

  function zpracujPrihlaseni(e) {
    if (e) e.preventDefault();
    skryjChybuLoginu();
    var vyberOsoba = document.getElementById("login-osoba");
    var poleHeslo = document.getElementById("login-heslo");
    var idOsoby = vyberOsoba ? vyberOsoba.value : "";
    var heslo = poleHeslo ? poleHeslo.value : "";

    if (!idOsoby) {
      zobrazChybuLoginu("Vyber osobu ze seznamu.");
      return;
    }
    if (!heslo) {
      zobrazChybuLoginu("Zadej heslo.");
      if (poleHeslo) poleHeslo.focus();
      return;
    }
    if (!window.Auth || typeof Auth.prihlas !== "function") {
      zobrazChybuLoginu("Přihlašovací modul se nenačetl. Zkus obnovit stránku.");
      return;
    }

    nastavNacitaniTlacitka(true);
    Auth.prihlas(idOsoby, heslo)
      .then(function (vysledek) {
        if (!vysledek || !vysledek.ok) {
          zobrazChybuLoginu((vysledek && vysledek.chyba) || "Přihlášení se nezdařilo.");
          nastavNacitaniTlacitka(false);
          if (poleHeslo) {
            poleHeslo.value = "";
            poleHeslo.focus();
          }
          return;
        }
        if (poleHeslo) poleHeslo.value = "";
        if (window.GH && typeof GH.init === "function") {
          GH.init({ token: Auth.token, jeZapis: Auth.jePisar() });
        }
        zapniIndikatorUkladani();
        zobrazAplikaci();
        App.start().then(function () {
          nastavNacitaniTlacitka(false);
        });
      })
      .catch(function (chyba) {
        console.error("Přihlášení selhalo neočekávaně:", chyba);
        zobrazChybuLoginu("Přihlášení se nezdařilo — neočekávaná chyba.");
        nastavNacitaniTlacitka(false);
      });
  }

  function odhlasit() {
    if (window.GH && typeof GH.zastavPolling === "function") {
      GH.zastavPolling();
    }
    if (window.Auth && typeof Auth.odhlas === "function") {
      Auth.odhlas(); // sam smaze pamet i localStorage a udela reload stranky
    } else {
      window.location.reload();
    }
  }

  // ==================================================================
  // DEMO REZIM (KONTRAKT_DODATEK.md §E)
  // ==================================================================
  //
  // Cely tenhle blok se v ostrem provozu NIKDY nespusti. Zapina se jen
  // dvema zpusoby:
  //   1. demo.html nastavi window.DEMO = true prvnim skriptem v <head>
  //      (jeste pred nactenim auth.js/gh.js/app.js),
  //   2. index.html otevreny s "?demo=1" A ZAROVEN ma nactenou konstantu
  //      DEMO_DATA (js/demo-data.js) — bez ni by demo nemelo z ceho brat
  //      data, takze se v takovem pripade zamerne neaktivuje.
  // index.html bez "?demo=1" (= ostry provoz) nesplni ani jednu podminku.
  //
  // Co demo dela:
  //   * preskoci prihlasovaci obrazovku a prihlasi fiktivniho super admina
  //     (identitu si vezme Auth ze zapecenych dat — viz Auth.prihlasDemo),
  //   * naplni App.data HLUBOKOU kopii DEMO_DATA (konstanta se nikdy
  //     needituje — kdyz nekdo v demu neco zmeni, meni se jen ta kopie),
  //   * vlozi nad hlavicku oranzovy pruh s prepinacem roli a tlacitkem
  //     "Vymazat demo data".
  // Zapisy resi js/gh.js (pamet + localStorage pod klicem "kostky_demo"),
  // sit se nepouziva vubec.

  var DEMO_KLIC_ULOZISTE = "kostky_demo";

  // Poradi tlacitek v prepinaci = poradi z dodatku §E.
  var DEMO_ROLE = [
    { kod: "superadmin", nazev: "super admin" },
    { kod: "admin", nazev: "admin" },
    { kod: "editor", nazev: "editor" },
    { kod: "ctenar", nazev: "čtenář" }
  ];

  // Klice App.data, ktere se plni z DEMO_DATA. Zamerne se NEbere
  // Object.keys(DEMO_DATA) — DEMO_DATA ma navic klic "foto_nalet"
  // (popis snimku z naletu), ktery do App.data nepatri; ten cte
  // sekce Casosber z konstanty NALET v js/nalet.js.
  var DEMO_KLICE_DAT = [
    "nastaveni", "pristupy", "lide", "plan",
    "navstevy", "materialy", "aktivita", "casosber", "pripominky", "harmonogram", "nalet"
  ];

  function jeDemoVUrl() {
    return /(^\?|&)demo=1(&|$)/.test(window.location.search || "");
  }

  function maDemoData() {
    return typeof DEMO_DATA !== "undefined" && !!DEMO_DATA;
  }

  function jeDemoRezim() {
    if (window.DEMO === true) {
      return true;
    }
    if (jeDemoVUrl() && maDemoData()) {
      // index.html?demo=1 — zapneme globál, aby demo videly i Auth a GH
      // (obe vrstvy se ptaji vylucne na window.DEMO)
      window.DEMO = true;
      return true;
    }
    return false;
  }

  // index.html se svym poradim skriptu js/demo-data.js vubec nenacita (to dela
  // jen demo.html). Aby fungoval i odkaz "index.html?demo=1" z dodatku §E,
  // dotahne se soubor v takovem pripade dodatecne. Kdyz se nenacte (treba
  // proto, ze na serveru neni), demo se zamerne NEZAPNE a appka pokracuje
  // normalnim prihlasenim — nikdy se nespusti demo bez dat.
  function dotahniDemoData(hotovo) {
    var skript = document.createElement("script");
    skript.src = "js/demo-data.js";
    skript.addEventListener("load", function () {
      hotovo(maDemoData());
    });
    skript.addEventListener("error", function () {
      console.warn("Demo režim (?demo=1) se nezapnul — js/demo-data.js se nepodařilo načíst.");
      hotovo(false);
    });
    document.head.appendChild(skript);
  }

  function hlubokaKopie(hodnota) {
    return JSON.parse(JSON.stringify(hodnota));
  }

  // App.data se naplni jeste PRED App.start(), aby sekce mely co vykreslit
  // i kdyby nacteni z GH z jakehokoli duvodu selhalo. App.start() pak
  // stejna data prevezme z GH (ktere v demu cte localStorage/DEMO_DATA).
  function naplnAppDataZDemoDat() {
    if (typeof DEMO_DATA === "undefined" || !DEMO_DATA) {
      console.warn("Demo režim je zapnutý, ale js/demo-data.js není načtený — data budou prázdná.");
      return;
    }
    DEMO_KLICE_DAT.forEach(function (klic) {
      var obalka = DEMO_DATA[klic];
      if (obalka && typeof obalka === "object") {
        App.uloz(klic, hlubokaKopie(obalka)); // hluboka kopie — konstanta zustava netknuta
      }
    });
  }

  // Zalozni styl pruhu pro pripad, ze se demo pusti z index.html?demo=1
  // (tam zadny <style id="demo-pruh-styl"> neni — ten ma jen demo.html).
  // Obsah je schvalne stejny jako v demo.html; kdyz uz blok existuje,
  // nevklada se nic.
  var DEMO_STYL =
    ".demo-pruh{order:-1;flex:0 0 calc(100% + 32px);margin:-10px -16px 0;" +
    "box-sizing:border-box;display:flex;flex-wrap:wrap;align-items:center;" +
    "gap:8px 16px;padding:9px 16px;background:#f08a1e;color:#1a1206;" +
    "font-size:0.86rem;font-weight:600;line-height:1.35;border-bottom:2px solid #b8630c}" +
    ".demo-pruh-text{margin-right:auto}" +
    ".demo-pruh-role{display:flex;flex-wrap:wrap;align-items:center;gap:6px}" +
    ".demo-pruh-btn{font:inherit;padding:3px 10px;border-radius:999px;" +
    "border:1px solid rgba(26,18,6,.45);background:rgba(255,255,255,.35);" +
    "color:#1a1206;cursor:pointer}" +
    ".demo-pruh-btn:hover{background:rgba(255,255,255,.62)}" +
    '.demo-pruh-btn[aria-pressed="true"]{background:#1a1206;border-color:#1a1206;color:#f6a94a}' +
    ".demo-pruh-btn:focus-visible,.demo-pruh-vymazat:focus-visible{outline:2px solid #1a1206;outline-offset:2px}" +
    ".demo-pruh-vymazat{font:inherit;padding:4px 12px;border-radius:6px;" +
    "border:1px solid #1a1206;background:transparent;color:#1a1206;cursor:pointer}" +
    ".demo-pruh-vymazat:hover{background:rgba(26,18,6,.14)}" +
    "@media (max-width:719px){.demo-pruh{font-size:0.78rem;gap:6px 10px;padding:7px 12px}" +
    ".demo-pruh-btn{padding:2px 8px}.demo-pruh-vymazat{padding:3px 9px}}";

  function zajistiDemoStyl() {
    if (document.getElementById("demo-pruh-styl")) {
      return; // demo.html si styl nese sam
    }
    var styl = document.createElement("style");
    styl.id = "demo-pruh-styl";
    styl.textContent = DEMO_STYL;
    document.head.appendChild(styl);
  }

  // "Vymazat demo data" — zahodi ulozeny stav a prenacte stranku, takze
  // se demo nastartuje znovu z cistych DEMO_DATA.
  function vymazDemoData() {
    try {
      window.localStorage.removeItem(DEMO_KLIC_ULOZISTE);
    } catch (chyba) {
      console.warn("Demo: localStorage nejde vyčistit.", chyba);
    }
    window.location.reload();
  }

  function oznacAktivniDemoRoli(tlacitka) {
    var aktualni = window.Auth && Auth.role ? Auth.role : null;
    tlacitka.forEach(function (btn) {
      btn.setAttribute("aria-pressed", btn.getAttribute("data-role") === aktualni ? "true" : "false");
    });
  }

  // Prepinac roli — kvuli tomu, aby si Franta (a lide z PORR) mohli
  // prohlednout, co ve stejne appce uvidi kdo. U role "ctenar" musi zmizet
  // uplne vsechny editacni prvky vcetne sekce Sprava.
  function prepniDemoRoli(kod, tlacitka) {
    if (!window.Auth || typeof Auth.nastavDemoRoli !== "function") {
      return;
    }
    if (!Auth.nastavDemoRoli(kod)) {
      return;
    }
    if (window.GH && typeof GH.init === "function") {
      // v demu zadny token neni, jde jen o vnitrni "smim zapisovat" v GH
      GH.init({ token: null, jeZapis: Auth.jePisar() });
    }
    oznacAktivniDemoRoli(tlacitka);
    nastavHlavicku();
    nastavViditelnostSekci();
    ohlasZmenuRole();
    App.toast("Zobrazuji appku jako: " + nazevRole(kod), "info");

    // Kdyz clovek koukal na Spravu a prepne se na roli, ktera na ni nema
    // pravo, presmerujeme ho — zmena hashe sama vyvola prekresleni routerem.
    if (!maPravoNaSekci(aktualniSekce || ziskejSekciZHashe())) {
      App.jdiNa("#prehled");
      return;
    }
    App.prekresli();
  }

  function postavDemoPruh() {
    var pruh = App.el("div", "demo-pruh");
    pruh.id = "demo-pruh";

    pruh.appendChild(
      App.el("span", "demo-pruh-text", "DEMO — data jsou jen ve tvém prohlížeči, nikam se neukládají.")
    );

    var prepinac = App.el("div", "demo-pruh-role");
    prepinac.appendChild(App.el("span", "demo-pruh-popisek", "Zobrazit jako:"));
    var tlacitka = [];
    DEMO_ROLE.forEach(function (polozka) {
      var btn = App.el("button", "demo-pruh-btn", polozka.nazev);
      btn.type = "button";
      btn.setAttribute("data-role", polozka.kod);
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", function () {
        prepniDemoRoli(polozka.kod, tlacitka);
      });
      tlacitka.push(btn);
      prepinac.appendChild(btn);
    });
    pruh.appendChild(prepinac);

    var btnVymazat = App.el("button", "demo-pruh-vymazat", "Vymazat demo data");
    btnVymazat.type = "button";
    btnVymazat.addEventListener("click", vymazDemoData);
    pruh.appendChild(btnVymazat);

    oznacAktivniDemoRoli(tlacitka);
    return pruh;
  }

  // Pruh jde jako PRVNI prvek dovnitr hlavicky (#hlavicka), ne nad ni —
  // hlavicka je "position: sticky", takze pruh s prepinacem roli zustane videt
  // i po odrolovani a na uzkem displeji se pri prepinani sekci neztrati.
  // Roztazeni pres celou sirku resi styl .demo-pruh (viz DEMO_STYL vyse).
  function vlozDemoPruh() {
    if (document.getElementById("demo-pruh")) {
      return;
    }
    var hlavicka = document.querySelector("#layout .hlavicka");
    if (!hlavicka) {
      return;
    }
    zajistiDemoStyl();
    hlavicka.insertBefore(postavDemoPruh(), hlavicka.firstChild);
  }

  // Pozor na poradi: view-prehled.js a view-navstevy.js si volaji
  // App.registrujSekci az v posluchaci DOMContentLoaded (ostatni sekce se
  // registruji hned pri nacteni sveho skriptu). V ostrem provozu to nevadi —
  // App.start() bezi az po odeslani prihlasovaciho formulare, tedy dlouho po
  // DOMContentLoaded. Demo ale startuje hned pri nacteni app.js, takze bez
  // tohohle cekani by prvni vykresleni Prehledu skoncilo hlaskou "Sekce se
  // nenačetla.". Posluchace obou sekci jsou zaregistrovane driv nez tenhle
  // (jejich skripty se nacitaji pred app.js), takze se spusti pred nim.
  function azBudeDomHotovy(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  // Nahrada za zpracujPrihlaseni() — v demu se heslo neresi vubec.
  function spustDemo() {
    naplnAppDataZDemoDat();
    if (window.Auth && typeof Auth.prihlasDemo === "function") {
      Auth.prihlasDemo();
    }
    if (window.GH && typeof GH.init === "function") {
      GH.init({ token: null, jeZapis: !window.Auth || Auth.jePisar() });
    }
    zapniIndikatorUkladani();
    zobrazAplikaci();
    vlozDemoPruh();
    App.start();
  }

  // ------------------------------------------------------------------
  // Globalni odchytavani chyb (§ "Ošetři globální chyby")
  // ------------------------------------------------------------------

  window.onerror = function (zprava, zdroj, radek, sloupec, chyba) {
    console.error("Neošetřená chyba:", zprava, zdroj, radek, sloupec, chyba);
    App.toast("Nastala neočekávaná chyba v aplikaci.", "chyba");
    return false;
  };

  window.addEventListener("unhandledrejection", function (e) {
    console.error("Neošetřené odmítnutí promise:", e && e.reason);
    App.toast("Nastala neočekávaná chyba na pozadí.", "chyba");
  });

  // ------------------------------------------------------------------
  // Start
  // ------------------------------------------------------------------

  function inicializuj() {
    var form = document.getElementById("login-form");
    if (form) form.addEventListener("submit", zpracujPrihlaseni);
    var btnOdhlasit = document.getElementById("btn-odhlasit");
    if (btnOdhlasit) btnOdhlasit.addEventListener("click", odhlasit);
    // Demo (dodatek §E): prihlasovaci obrazovka se preskoci uplne — appka
    // se rovnou nastartuje nad zapecenymi daty. V ostrem provozu (index.html
    // bez "?demo=1") je jeDemoRezim() vzdy false, zadna dalsi vetev se
    // nespusti a pokracuje se normalnim loginem.
    if (jeDemoRezim()) {
      azBudeDomHotovy(spustDemo);
      return;
    }
    if (jeDemoVUrl()) {
      // index.html?demo=1 — data se teprve dotahnou, login zatim zustava
      dotahniDemoData(function (podarilo) {
        if (podarilo) {
          window.DEMO = true;
          azBudeDomHotovy(spustDemo);
        } else {
          pripravLogin();
        }
      });
      return;
    }
    pripravLogin();
  }

  inicializuj();
})();
