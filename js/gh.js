/**
 * gh.js — datova vrstva nad GitHub Contents API pro repo kostky-data (§7 kontraktu).
 *
 * Cte KONFIG.repo ("frantisekdron/kostky-data") a KONFIG.vetev ("main") z config.js.
 * Vsechny soubory v repu jsou base64 (Contents API) - vzdy prevadeny pres
 * TextEncoder/TextDecoder, aby se neponicily ceske znaky.
 *
 * Vystavuje globalni objekt GH:
 *   GH.init({ token, jeZapis })       -> ulozi token do PAMETI (nikdy do localStorage)
 *   GH.nacti(soubor)                  -> Promise<{ data, etag, sha }>
 *   GH.nactiVse()                     -> Promise<{ [soubor]: {data,etag,sha} }> (paralelne)
 *   GH.zmen(soubor, fn, popis)        -> Promise<object>  read-modify-write s retry
 *   GH.spustPolling(cb)               -> cb(soubor, data) pri kazde zmene, kazdych 25 s
 *   GH.zastavPolling()
 *   GH.noveId(prefix)                 -> "<prefix>-<timestamp36>-<4 nahodne znaky>" (§3)
 *   GH.nactiSoubor(cesta)             -> Promise<string|null>  binarni soubor (foto z
 *                                        privatniho repa) jako "data:image/jpeg;base64,..."
 *                                        (dodatek §A.6). V demo rezimu vraci relativni
 *                                        cestu do seed/ (viz komentar u funkce nize).
 *                                        Nikdy nevyhazuje - chyba -> null.
 *                                        Vysledek se cachuje v Map podle cesty.
 *   GH.nahrajSoubor(cesta, blob, popis) -> Promise<boolean>  PUT binarniho souboru
 *                                        (base64), pro budouci pouziti (dodatek §A.6).
 *
 * soubor je jeden z: "nastaveni" | "pristupy" | "lide" | "plan" | "navstevy" |
 *                     "materialy" | "aktivita" | "casosber" | "pripominky" |
 *                     "harmonogram" | "nalet" | "naklady"
 *
 * "naklady" (data/naklady.json) je zvlastni ve trech vecech: obalka nese misto
 * "polozky" jediny klic "sifrovano" = {salt, iv, ct} (obsah je zasifrovany
 * heslem, ktere zna jen superadmin — role v appce jsou organizacni, ne
 * kryptograficke, a zapisovy token do privatniho repa ma cely tym), mutatoru
 * se proto predava CELA obalka (ROZSIRENA_OBALKA), a soubor v repu jeste
 * nemusi existovat (NEPOVINNE) — pri prvnim zapisu ho appka sama zalozi.
 *
 * GH.zmen: 1) cerstvy GET+sha (nikdy z cache), 2) fn(mutovatelna) zmeni data NA MISTE
 * (pole "polozky" pro polozkove soubory, objekt "data" pro nastaveni/pristupy),
 * 3) verze++/zmeneno/zmenil, 4) PUT se sha. Pri 409/422 az 4x opakovani s prodlevou
 * 200/400/800/1600 ms. Po kazdem neuspesnem zapisu se zahodi ETag daneho souboru.
 * Po uspesne mutaci se zapise zaznam do aktivita.json (druh:"zmena") - jeho selhani
 * nesmi shodit hlavni operaci (jen console.warn) a nesmi rekurzivne zapisovat dalsi
 * aktivitu (aktivita.json ma pri zapisu z GH.zmen vlastni nizkourovnovy zapis).
 *
 * DEMO REZIM (KONTRAKT_DODATEK.md §E): kdyz je window.DEMO === true, GH neposle
 * ani jeden pozadavek na sit a config.js vubec nepotrebuje:
 *   GH.nacti / GH.nactiVse  -> data z localStorage["kostky_demo"], a co v nem
 *                              chybi, z konstanty DEMO_DATA (js/demo-data.js)
 *                              jako HLUBOKA kopie (konstanta se needituje)
 *   GH.zmen                 -> zmutuje ten stav v pameti (vcetne verze/zmeneno/
 *                              zmenil a zaznamu do aktivita.json) a ulozi CELY
 *                              stav zpatky do localStorage["kostky_demo"];
 *                              kontrola prava zapisu plati i tady, takze demo
 *                              prepnute na roli "ctenar" dostane stejnou hlasku
 *                              "Máš jen právo ke čtení." jako v ostrem provozu
 *   GH.spustPolling         -> nedela nic (nikdo jiny data nemeni)
 *   GH.nactiSoubor          -> vraci relativni cestu do seed/ (viz nize)
 *
 * DULEZITE - HTTP cache: GitHub API vraci na GET "Cache-Control: private, max-age=60",
 * takze prohlizec by bez zasahu obsluhoval opakovany GET na stejnou URL primo ze
 * sve vlastni HTTP cache (bez dotazu na sit) a po zapisu by tak videl porad stary
 * (predzapisovy) obsah az 60 s. Proto ghFetch pouziva "cache: no-store" u kazdeho
 * pozadavku - vzdy jde na sit. Rucni podminene cteni pres "If-None-Match" (polling)
 * tim neni dotcene: hlavicku posilame sami a GitHub server na ni odpovi skutecnym
 * HTTP 304, ktere se s "no-store" dostane az do JS (na rozdil od vychoziho rezimu
 * cache prohlizece, ktery by 304 mohl vyresit potichu sam ze sve cache).
 */

var GH = (function () {
  "use strict";

  var SOUBORY = {
    nastaveni: "data/nastaveni.json",
    pristupy: "data/pristupy.json",
    lide: "data/lide.json",
    plan: "data/plan.json",
    navstevy: "data/navstevy.json",
    materialy: "data/materialy.json",
    aktivita: "data/aktivita.json",
    casosber: "data/casosber.json",
    pripominky: "data/pripominky.json",
    harmonogram: "data/harmonogram.json",
    nalet: "data/nalet.json",
    // Naklady na provoz — sifrovany soubor jen pro superadmina (sekce
    // "naklady"). Obalka nese misto "polozky" klic "sifrovano" (viz
    // ROZSIRENA_OBALKA a NEPOVINNE nize) a v repu klidne jeste neexistuje.
    naklady: "data/naklady.json"
  };

  // ---- DEMO REZIM (KONTRAKT_DODATEK.md §E) ----------------------------------
  //
  // Kdyz je window.DEMO === true, GH nesmi poslat ani jeden pozadavek na sit.
  // Data drzi jeden objekt v pameti ("demoStav") ve stejnem tvaru, v jakem by
  // prisla z API: { <soubor>: {verze, zmeneno, zmenil, polozky|data}, ... }.
  // Zdroj pri startu: localStorage["kostky_demo"] (co si clovek v demu
  // nakliknul), a co v nem chybi, se dobere z konstanty DEMO_DATA
  // (js/demo-data.js) — vzdy jako HLUBOKA kopie, aby se konstanta needitovala.
  // Kazdy zapis (GH.zmen) rovnou uklada cely stav zpatky do localStorage.
  var DEMO_KLIC_ULOZISTE = "kostky_demo";
  var demoStav = null;

  function jeDemo() {
    return typeof window !== "undefined" && window.DEMO === true;
  }

  var ZPOZDENI_MS = [200, 400, 800, 1600];
  var MAX_POKUSU = ZPOZDENI_MS.length + 1; // 1 puvodni pokus + 4 opakovani
  var POLLING_MS = 25000;

  var tokenAktualni = null;
  var zapisPovolen = false;
  var etagy = {}; // soubor -> ETag posledniho uspesneho GET
  var zapisProbiha = false; // jednoduchy zamek - polling behem zapisu vynecha tik
  var pollingId = null;

  // ---- pomocne base64 <-> UTF-8 text prevody (Contents API vraci base64) ----

  function textNaBase64(text) {
    var bajty = new TextEncoder().encode(text);
    var binarniRetezec = "";
    for (var i = 0; i < bajty.length; i++) {
      binarniRetezec += String.fromCharCode(bajty[i]);
    }
    return btoa(binarniRetezec);
  }

  function base64NaText(base64) {
    var ocisteneBase64 = String(base64 || "").replace(/\s+/g, "");
    var binarniRetezec = atob(ocisteneBase64);
    var bajty = new Uint8Array(binarniRetezec.length);
    for (var i = 0; i < binarniRetezec.length; i++) {
      bajty[i] = binarniRetezec.charCodeAt(i);
    }
    return new TextDecoder().decode(bajty);
  }

  // ---- cesty k Contents API ----

  function cestaSouboru(soubor) {
    var cesta = SOUBORY[soubor];
    if (!cesta) {
      throw new Error("Neznamy datovy soubor: " + soubor);
    }
    return cesta;
  }

  function cestaObsahu(soubor) {
    return "contents/" + cestaSouboru(soubor);
  }

  // ---- nizkourovnovy fetch na GitHub API ----

  function ghFetch(metoda, cestaApi, telo, dalsiHlavicky) {
    var url = "https://api.github.com/repos/" + KONFIG.repo + "/" + cestaApi;
    var hlavicky = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (tokenAktualni) {
      hlavicky.Authorization = "Bearer " + tokenAktualni;
    }
    for (var klic in dalsiHlavicky) {
      if (Object.prototype.hasOwnProperty.call(dalsiHlavicky, klic)) {
        hlavicky[klic] = dalsiHlavicky[klic];
      }
    }
    // "no-store": vzdy na sit, nikdy neobsluhovat z HTTP cache prohlizece
    // (GitHub API vraci Cache-Control: private, max-age=60 - viz hlavickovy komentar)
    var moznosti = { method: metoda, headers: hlavicky, cache: "no-store" };
    if (telo !== null && telo !== undefined) {
      hlavicky["Content-Type"] = "application/json";
      moznosti.body = JSON.stringify(telo);
    }
    return fetch(url, moznosti);
  }

  // ---- lidske chybove hlasky (presne podle §7 kontraktu) ----

  function novaChyba(status, teloOdpovedi) {
    var hlaska;
    if (status === 401 || status === 403) {
      hlaska = "Přístup zamítnut — token vypršel nebo byl odebrán. Přihlas se znovu.";
    } else if (status === 404) {
      // overena past: GitHub u fine-grained tokenu vraci 404 i pri chybejicim opravneni
      hlaska = "Nemám právo zápisu do datového repa (GitHub u fine-grained tokenů vrací 404 i při chybějícím oprávnění). Zkontroluj token.";
    } else if (status === 409 || status === 422) {
      hlaska = "Konflikt při ukládání — někdo jiný změnil data současně. Zkus to znovu.";
    } else {
      hlaska = "Chyba GitHub API (" + status + ").";
    }
    var chyba = new Error(hlaska);
    chyba.hlaska = hlaska;
    chyba.status = status;
    chyba.telo = teloOdpovedi;
    return chyba;
  }

  function jeSitovaChyba(chyba) {
    return chyba instanceof TypeError;
  }

  function mapujChybu(chyba) {
    if (chyba && chyba.hlaska) {
      return chyba;
    }
    if (jeSitovaChyba(chyba)) {
      var sitovaChyba = new Error("Bez připojení. Změna se neuložila.");
      sitovaChyba.hlaska = sitovaChyba.message;
      sitovaChyba.puvodni = chyba;
      return sitovaChyba;
    }
    var obecnaChyba = new Error(
      "Neočekávaná chyba: " + (chyba && chyba.message ? chyba.message : String(chyba))
    );
    obecnaChyba.hlaska = obecnaChyba.message;
    return obecnaChyba;
  }

  // ---- ceka danou dobu (pro retry prodlevy) ----

  function pockej(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  // ---- kdo dela zmenu (identita z auth.js, drzena jen v pameti) ----

  function zjistiKdo() {
    if (typeof Auth !== "undefined" && Auth.ja && Auth.ja.id) {
      return Auth.ja.id;
    }
    return "neznamy";
  }

  // ---- ziska mutovatelnou cast obsahu: pole "polozky" nebo objekt "data" ----

  // Soubory, jejichz obalka nese vedle "polozky" jeste dalsi datovy klic
  // (casosber.json ma podle dodatku SA.4 blok "popisy"). Mutatoru se u nich
  // predava CELA obalka, jinak by se ten blok nikdy nedal zapsat.
  // "naklady" tu je ze stejneho duvodu z opacne strany: jeho obalka zadne
  // "polozky" NEMA (nese jen sifrovany blob v klici "sifrovano"), takze by
  // mutator dostal celou obalku i tak — ale radeji je to receno nahlas, at
  // to nikdo pozdeji neprepise na pole.
  var ROZSIRENA_OBALKA = { casosber: true, naklady: true };

  // Soubory, jejichz chybejici verze v repu NENI porucha, ale normalni
  // vychozi stav. Bez tohohle by 404 na data/naklady.json rozsvitil
  // vsem cervenou hlasku "Nevidite aktualni data" (a to i lidem, kteri
  // o sekci naklady vubec nemaji vedet) a polling by uz nikdy nezezelenal.
  // Takovy soubor umi appka pri prvnim zapisu sama zalozit (viz zapisSPokusy).
  var NEPOVINNE = { naklady: true };

  function ziskejMutovatelnaData(obsah, soubor) {
    if (soubor && ROZSIRENA_OBALKA[soubor]) {
      return obsah;
    }
    if (Array.isArray(obsah.polozky)) {
      return obsah.polozky;
    }
    if (obsah.data && typeof obsah.data === "object") {
      return obsah.data;
    }
    return obsah;
  }

  // ---- entita pro auto-zapis do aktivita.json podle souboru ----

  function urciEntitu(soubor) {
    switch (soubor) {
      case "navstevy":
        return "navsteva";
      case "plan":
        return "milnik";
      case "materialy":
        return "material";
      case "lide":
        return "osoba";
      default:
        return "projekt";
    }
  }

  // ---- DEMO REZIM: uloziste v pameti + localStorage (dodatek §E) -------------

  function hlubokaKopie(hodnota) {
    return JSON.parse(JSON.stringify(hodnota));
  }

  // Spravny tvar prazdne obalky pro dany soubor — pouzije se, kdyz soubor
  // chybi i v ulozenem stavu i v DEMO_DATA (at demo na nicem nespadne).
  function prazdnaDemoObalka(soubor) {
    if (soubor === "nastaveni" || soubor === "pristupy") {
      return { verze: 0, zmeneno: null, zmenil: null, data: {} };
    }
    if (soubor === "casosber") {
      // casosber ma navic klic "popisy" (dodatek §A.4)
      return { verze: 0, zmeneno: null, zmenil: null, polozky: [], popisy: {} };
    }
    if (soubor === "naklady") {
      // naklady nemaji "polozky" — cely obsah je zasifrovany v "sifrovano"
      return { verze: 0, zmeneno: null, zmenil: null, sifrovano: null };
    }
    return { verze: 0, zmeneno: null, zmenil: null, polozky: [] };
  }

  function nactiDemoZUloziste() {
    var surova;
    try {
      surova = window.localStorage.getItem(DEMO_KLIC_ULOZISTE);
    } catch (chyba) {
      return null; // localStorage nedostupny (soukromy rezim) — demo pojede jen v pameti
    }
    if (!surova) {
      return null;
    }
    try {
      var stav = JSON.parse(surova);
      return stav && typeof stav === "object" ? stav : null;
    } catch (chybaParsovani) {
      console.warn("Demo: uložený stav nejde přečíst, beru výchozí data.", chybaParsovani);
      return null;
    }
  }

  function ulozDemoDoUloziste() {
    try {
      window.localStorage.setItem(DEMO_KLIC_ULOZISTE, JSON.stringify(demoStav));
    } catch (chyba) {
      // typicky prekroceny limit nebo soukromy rezim — demo bezi dal z pameti,
      // jen se zmeny neprenesou pres prenacteni stranky
      console.warn("Demo: stav se nepodařilo uložit do localStorage.", chyba);
    }
  }

  // Vrati (a pri prvnim volani sestavi) demo stav. Prednost ma localStorage,
  // pak DEMO_DATA, pak prazdna obalka.
  function demoData() {
    if (demoStav) {
      return demoStav;
    }
    var ulozeny = nactiDemoZUloziste();
    var vychozi = typeof DEMO_DATA !== "undefined" && DEMO_DATA ? DEMO_DATA : {};
    demoStav = {};
    Object.keys(SOUBORY).forEach(function (soubor) {
      if (ulozeny && ulozeny[soubor] && typeof ulozeny[soubor] === "object") {
        demoStav[soubor] = ulozeny[soubor]; // uz je to samostatny objekt z JSON.parse
      } else if (vychozi[soubor] && typeof vychozi[soubor] === "object") {
        demoStav[soubor] = hlubokaKopie(vychozi[soubor]); // konstanta zustava netknuta
      } else {
        demoStav[soubor] = prazdnaDemoObalka(soubor);
      }
    });
    return demoStav;
  }

  // Demo varianta GH.zmen — stejny postup jako ostry zapis (zmena na miste,
  // verze++, zmeneno/zmenil, zaznam do aktivity), jen misto PUT na API se
  // vysledek ulozi do localStorage. Nikdy nic neposila na sit.
  function demoZmen(soubor, fn, popis) {
    var stav = demoData();
    var obsah = stav[soubor];
    if (!obsah) {
      return Promise.reject(mapujChybu(new Error("Neznamy datovy soubor: " + soubor)));
    }
    try {
      fn(ziskejMutovatelnaData(obsah, soubor));
    } catch (chybaMutace) {
      return Promise.reject(mapujChybu(chybaMutace));
    }
    obsah.verze = (obsah.verze || 0) + 1;
    obsah.zmeneno = new Date().toISOString();
    obsah.zmenil = zjistiKdo();

    // zaznam do aktivity — stejne jako v ostrem provozu, a stejne tak nesmi
    // shodit hlavni operaci (proto zadny throw) ani rekurzivne volat sam sebe
    if (soubor !== "aktivita" && popis) {
      var aktivita = stav.aktivita;
      if (aktivita && Array.isArray(aktivita.polozky)) {
        aktivita.polozky.push({
          id: noveId("akt"),
          entita: urciEntitu(soubor),
          entita_id: null,
          druh: "zmena",
          text: popis,
          kdo: zjistiKdo(),
          kdy: new Date().toISOString(),
          smazano: null
        });
        aktivita.verze = (aktivita.verze || 0) + 1;
        aktivita.zmeneno = new Date().toISOString();
        aktivita.zmenil = zjistiKdo();
      }
    }

    ulozDemoDoUloziste();
    return Promise.resolve(obsah);
  }

  // ---- cerstve nacteni jednoho souboru (vzdy plny GET, zadny If-None-Match) ----

  function provedGet(soubor) {
    var cesta = cestaObsahu(soubor) + "?ref=" + encodeURIComponent(KONFIG.vetev);
    return ghFetch("GET", cesta, null, {}).then(function (odpoved) {
      if (!odpoved.ok) {
        return odpoved
          .json()
          .catch(function () {
            return null;
          })
          .then(function (teloChyby) {
            throw novaChyba(odpoved.status, teloChyby);
          });
      }
      return odpoved.json().then(function (telo) {
        var data = JSON.parse(base64NaText(telo.content));
        etagy[soubor] = odpoved.headers.get("ETag") || null;
        return { data: data, etag: etagy[soubor], sha: telo.sha };
      });
    });
  }

  function nacti(soubor) {
    // demo (dodatek §E): zadna sit, data z localStorage/DEMO_DATA. Tvar
    // navratove hodnoty je stejny jako z API, jen bez etagu a sha (v demu
    // nemaji co delat — polling nebezi a zapis se neresi pres sha).
    if (jeDemo()) {
      try {
        cestaSouboru(soubor); // stejna kontrola neznameho souboru jako v ostrem provozu
      } catch (chybaNazvu) {
        return Promise.reject(mapujChybu(chybaNazvu));
      }
      return Promise.resolve({ data: demoData()[soubor], etag: null, sha: null });
    }
    return provedGet(soubor).catch(function (chyba) {
      throw mapujChybu(chyba);
    });
  }

  // Demo resi uz nacti() vyse — nactiVse() nad nim jen posklada vysledek,
  // takze i v demu vraci data z localStorage/DEMO_DATA a nikam nesaha.
  // Prázdná obálka pro soubor, který v repu (ještě) není.
  function prazdnaObalka(soubor) {
    var objektove = { nastaveni: true, pristupy: true, harmonogram: true, nalet: true };
    var zaklad = { verze: 0, zmeneno: null, zmenil: null };
    if (soubor === "naklady") {
      // zadne "polozky" — obsah zije jen jako sifrovany blob (sekce Naklady)
      zaklad.sifrovano = null;
      return zaklad;
    }
    if (objektove[soubor]) {
      zaklad.data = (soubor === "nalet") ? { teren_m: 260, polozky: [] } : {};
    } else {
      zaklad.polozky = [];
    }
    return zaklad;
  }

  function nactiVse() {
    var klice = Object.keys(SOUBORY);
    return Promise.all(
      klice.map(function (soubor) {
        return nacti(soubor)
          .then(function (vysledek) {
            return { soubor: soubor, vysledek: vysledek };
          })
          .catch(function (chyba) {
            // Chybějící datový soubor NESMÍ položit celou appku. Dřív to byl
            // Promise.all bez záchytu, takže jediné 404 (třeba nový soubor,
            // který ještě nikdo nenahrál) nechalo kokpit úplně prázdný
            // a chyba svedla vinu na token. Teď se jen ohlásí a pokračuje se.
            if (chyba && (chyba.stav === 404 || chyba.status === 404)) {
              if (NEPOVINNE[soubor]) {
                // Chybejici nepovinny soubor je normalni vychozi stav, ne porucha —
                // nehlasi se jako "nenacteno" (jinak by o nem vedel cely tym).
                return { soubor: soubor, vysledek: { data: prazdnaObalka(soubor), etag: null } };
              }
              console.warn("Datový soubor " + soubor + " v repu není — pokračuji bez něj.");
              return { soubor: soubor, vysledek: { data: prazdnaObalka(soubor), etag: null }, chybel: true };
            }
            throw chyba;
          });
      })
    ).then(function (vysledky) {
      var vystup = {};
      var chybejici = [];
      vysledky.forEach(function (polozka) {
        vystup[polozka.soubor] = polozka.vysledek;
        if (polozka.chybel) chybejici.push(polozka.soubor);
      });
      if (chybejici.length) vystup.__chybejici = chybejici;
      return vystup;
    });
  }

  // ---- read-modify-write s retry na 409/422 (jadro GH.zmen i zapisu aktivity) ----

  function zapisSPokusy(soubor, fn) {
    // Nepovinny soubor (NEPOVINNE) v repu jeste byt nemusi. Cerstvy GET by
    // pak skoncil 404 a uzivatel by dostal hlasku o chybejicim opravneni
    // k tokenu — misto toho zacneme od prazdne obalky a PUT bez "sha" soubor
    // rovnou zalozi (presne tak Contents API vytvari novy soubor).
    function nactiNeboZaloz(soubor) {
      return provedGet(soubor).catch(function (chyba) {
        if (NEPOVINNE[soubor] && chyba && chyba.status === 404) {
          return { data: prazdnaObalka(soubor), etag: null, sha: null };
        }
        throw chyba;
      });
    }

    function jedenPokus(pokus) {
      return nactiNeboZaloz(soubor).then(function (aktualni) {
        var obsah = aktualni.data;
        var mutovatelna = ziskejMutovatelnaData(obsah, soubor);
        fn(mutovatelna);
        obsah.verze = (obsah.verze || 0) + 1;
        obsah.zmeneno = new Date().toISOString();
        obsah.zmenil = zjistiKdo();

        var telo = {
          message: "kokpit: aktualizace " + soubor + " (verze " + obsah.verze + ")",
          content: textNaBase64(JSON.stringify(obsah, null, 2)),
          branch: KONFIG.vetev
        };
        // "sha" se posila jen u souboru, ktery uz existuje. U zakladani noveho
        // (viz nactiNeboZaloz vyse) by prazdna sha zapis shodila.
        if (aktualni.sha) {
          telo.sha = aktualni.sha;
        }

        return ghFetch("PUT", cestaObsahu(soubor), telo, {}).then(function (odpoved) {
          if ((odpoved.status === 409 || odpoved.status === 422) && pokus < MAX_POKUSU) {
            var zpozdeni = ZPOZDENI_MS[pokus - 1];
            return pockej(zpozdeni).then(function () {
              return jedenPokus(pokus + 1);
            });
          }
          if (!odpoved.ok) {
            return odpoved
              .json()
              .catch(function () {
                return null;
              })
              .then(function (teloChyby) {
                throw novaChyba(odpoved.status, teloChyby);
              });
          }
          // uspesny zapis - stary ETag uz nesedi, necham ho zahodit at se pri
          // dalsim cteni/pollingu udela cerstvy GET a nastavi se novy
          delete etagy[soubor];
          return obsah;
        });
      });
    }

    return jedenPokus(1).catch(function (chyba) {
      // po jakemkoli neuspesnem zapisu zahodit ETag (jinak 304 zamrzne appku)
      delete etagy[soubor];
      throw mapujChybu(chyba);
    });
  }

  // ---- automaticky zaznam do aktivita.json (druh:"zmena"); nikdy nerekurzuje ----

  function zapisAktivitu(soubor, popis) {
    return zapisSPokusy("aktivita", function (polozky) {
      polozky.push({
        id: noveId("akt"),
        entita: urciEntitu(soubor),
        entita_id: null, // GH.zmen nedostava id konkretni polozky, viz POZNAMKY_gh.md
        druh: "zmena",
        text: popis,
        kdo: zjistiKdo(),
        kdy: new Date().toISOString(),
        smazano: null
      });
    }).catch(function (chyba) {
      console.warn("Zápis aktivity selhal (hlavní operace proběhla v pořádku):", chyba);
    });
  }

  // ---- verejne GH.zmen ----

  function zmen(soubor, fn, popis) {
    if (!zapisPovolen) {
      var chybaCteni = new Error("Máš jen právo ke čtení.");
      chybaCteni.hlaska = chybaCteni.message;
      return Promise.reject(chybaCteni);
    }
    // demo (dodatek §E): zmena jde do pameti a do localStorage, nikam se
    // neposila. Kontrola prava zapisu vyse plati i tady, aby se prepnuti na
    // roli "ctenar" v demu chovalo stejne jako v ostrem provozu.
    if (jeDemo()) {
      return demoZmen(soubor, fn, popis);
    }
    zapisProbiha = true;
    return zapisSPokusy(soubor, fn)
      .then(function (obsah) {
        if (soubor !== "aktivita" && popis) {
          // zamerne bez cekani (fire-and-forget) - selhani nesmi shodit hlavni operaci
          zapisAktivitu(soubor, popis);
        }
        return obsah;
      })
      .finally(function () {
        zapisProbiha = false;
      });
  }

  // ---- polling kazdych 25 s pres If-None-Match; 304 = beze zmeny ----

  // Soubory, u kterych posledni polling selhal. Bez teto evidence koncilo
  // selhani jen v konzoli: data zustala zastarala, indikator svitil zelene
  // a uzivatel nemel jak poznat, ze uz nevidi aktualni stav.
  var pollingChyby = {};
  var naChybuPollingu = null;

  // Jeden tik se ptá na 11 souborů. Kdyby se hlásilo hned u každého, appka
  // by se při výpadku překreslila jedenáctkrát za sebou — hlásíme proto
  // až souhrnně na konci tiku.
  var hlaseniNaplanovano = false;

  function ohlasZmenuStavu() {
    if (hlaseniNaplanovano || typeof naChybuPollingu !== "function") return;
    hlaseniNaplanovano = true;
    Promise.resolve().then(function () {
      hlaseniNaplanovano = false;
      if (typeof naChybuPollingu === "function") naChybuPollingu(chybejiciSoubory());
    });
  }

  function oznacChybuPollingu(soubor, duvod) {
    var bylo = !!pollingChyby[soubor];
    pollingChyby[soubor] = duvod || true;
    if (!bylo) ohlasZmenuStavu();
  }

  function zrusChybuPollingu(soubor) {
    if (!pollingChyby[soubor]) return;
    delete pollingChyby[soubor];
    ohlasZmenuStavu();
  }

  function chybejiciSoubory() {
    return Object.keys(pollingChyby);
  }

  function provedPollingTik(cb) {
    if (zapisProbiha) {
      return; // jednoduchy zamek - behem rozdelaneho zapisu tento tik preskocime
    }
    Object.keys(SOUBORY).forEach(function (soubor) {
      var cesta = cestaObsahu(soubor) + "?ref=" + encodeURIComponent(KONFIG.vetev);
      var hlavicky = {};
      if (etagy[soubor]) {
        hlavicky["If-None-Match"] = etagy[soubor];
      }
      ghFetch("GET", cesta, null, hlavicky)
        .then(function (odpoved) {
          if (odpoved.status === 304) {
            zrusChybuPollingu(soubor); // dotaz prosel, data jsou jen beze zmeny
            return; // callback se nevola
          }
          if (odpoved.status === 404 && NEPOVINNE[soubor]) {
            zrusChybuPollingu(soubor); // soubor zatim neexistuje — to je v poradku
            return;
          }
          if (!odpoved.ok) {
            console.warn("Polling: chyba při načítání '" + soubor + "' (" + odpoved.status + ")");
            oznacChybuPollingu(soubor, odpoved.status);
            return;
          }
          return odpoved.json().then(function (telo) {
            var data = JSON.parse(base64NaText(telo.content));
            etagy[soubor] = odpoved.headers.get("ETag") || etagy[soubor];
            zrusChybuPollingu(soubor);
            cb(soubor, data);
          });
        })
        .catch(function (chyba) {
          console.warn("Polling: síťová chyba u '" + soubor + "'", chyba);
          oznacChybuPollingu(soubor, "síť");
        });
    });
  }

  function spustPolling(cb, cbChyba) {
    zastavPolling();
    naChybuPollingu = typeof cbChyba === "function" ? cbChyba : null;
    // demo (dodatek §E): nikdo jiny data nemeni a hlavne se nesmi na sit —
    // polling se proto vubec nespousti.
    if (jeDemo()) {
      return;
    }
    pollingId = window.setInterval(function () {
      provedPollingTik(cb);
    }, POLLING_MS);
  }

  function zastavPolling() {
    if (pollingId !== null) {
      window.clearInterval(pollingId);
      pollingId = null;
    }
  }

  // ---- generovani ID podle §3: <prefix>-<timestamp36>-<4 nahodne znaky> ----

  function nahodnyRetezec(delka) {
    var znaky = "abcdefghijklmnopqrstuvwxyz0123456789";
    var vysledek = "";
    var nahodnaPole = window.crypto.getRandomValues(new Uint8Array(delka));
    for (var i = 0; i < delka; i++) {
      vysledek += znaky.charAt(nahodnaPole[i] % znaky.length);
    }
    return vysledek;
  }

  function noveId(prefix) {
    var casovyRazitko36 = Date.now().toString(36);
    return prefix + "-" + casovyRazitko36 + "-" + nahodnyRetezec(4);
  }

  // ---- GH.nactiSoubor / GH.nahrajSoubor: binarni soubory (foto z naletu) v privatnim
  // repu (dodatek §A.6). Contents API vraci/prijima obsah jako base64 - pro foto ho
  // NEPREVADIME pres TextEncoder/TextDecoder (ty jsou pro text), jen ho poskladame
  // primo do "data:" URL, resp. slozime z Blobu pred odeslanim.

  // cache nactenych binarnich souboru: cesta -> "data:...;base64,..." (v demo rezimu
  // relativni cesta do seed/). Zamerne Map, ne obycejny objekt - klicem je cesta ze
  // vstupu a Map nema prototypove klice ("__proto__", "constructor", ...).
  var cacheSouboru = new Map();

  // ---- odhad MIME typu z pripony souboru (vsechny nase soubory jsou fotky z dronu) ----

  function odhadniTypObsahu(cesta) {
    var cestaMala = String(cesta || "").toLowerCase();
    if (cestaMala.slice(-4) === ".png") {
      return "image/png";
    }
    if (cestaMala.slice(-4) === ".gif") {
      return "image/gif";
    }
    if (cestaMala.slice(-5) === ".webp") {
      return "image/webp";
    }
    // vychozi: .jpg / .jpeg i cokoli neznameho - vsechny soubory naletu jsou JPEG
    return "image/jpeg";
  }

  // ---- prevod cesty v privatnim repu na relativni cestu do seed/ (demo rezim) ----
  //
  // V privatnim repu kostky-data lezi fotky naletu jako "foto/nalet/nahled/<id>.jpg"
  // a "foto/nalet/velky/<id>.jpg" (dodatek §A.6). V demo rezimu zadny repo ani token
  // neni a stejne obrazky jsou primo vedle appky ve slozkach "seed/foto_nalet/nahled/"
  // a "seed/foto_nalet/velky/" - proto se prefix "foto/" prevadi na "foto_":
  //   "foto/nalet/nahled/foto-01.jpg" -> "seed/foto_nalet/nahled/foto-01.jpg"
  // Cesta bez prefixu "foto/" se jen predradi "seed/".
  function demoCestaKSouboru(cesta) {
    var ocistena = String(cesta || "").replace(/^\/+/, "");
    if (ocistena.indexOf("..") !== -1) {
      return null; // zadne vyskakovani ze slozky appky
    }
    return "seed/" + ocistena.replace(/^foto\//, "foto_");
  }

  // ---- nacteni binarniho souboru jako "data:" URL, s cache podle cesty ----
  //
  // V demo rezimu (window.DEMO === true, viz dodatek §E) se vubec nesaha na API -
  // vrati se rovnou relativni cesta do seed/ (viz demoCestaKSouboru vyse).
  function nactiSoubor(cesta) {
    if (cacheSouboru.has(cesta)) {
      return Promise.resolve(cacheSouboru.get(cesta));
    }
    if (typeof window !== "undefined" && window.DEMO === true) {
      var demoCesta = demoCestaKSouboru(cesta);
      cacheSouboru.set(cesta, demoCesta);
      return Promise.resolve(demoCesta);
    }
    var cestaApi = "contents/" + cesta + "?ref=" + encodeURIComponent(KONFIG.vetev);
    return ghFetch("GET", cestaApi, null, {})
      .then(function (odpoved) {
        if (!odpoved.ok) {
          throw new Error("GH.nactiSoubor: HTTP " + odpoved.status + " pro " + cesta);
        }
        return odpoved.json();
      })
      .then(function (telo) {
        var cistaBase64 = String(telo.content || "").replace(/\s+/g, "");
        var dataUrl = "data:" + odhadniTypObsahu(cesta) + ";base64," + cistaBase64;
        cacheSouboru.set(cesta, dataUrl);
        return dataUrl;
      })
      .catch(function (chyba) {
        console.warn("GH.nactiSoubor selhalo pro '" + cesta + "':", chyba);
        return null; // chyba -> null, nikdy nevyhazovat
      });
  }

  // ---- ArrayBuffer -> base64 (po castech, at nespadne na volani apply s velkym polem) ----

  function arrayBufferNaBase64(bufferPole) {
    var bajty = new Uint8Array(bufferPole);
    var binarniRetezec = "";
    var VELIKOST_KUSU = 0x8000; // 32768 - bezpecne pod limitem argumentu fromCharCode.apply
    for (var i = 0; i < bajty.length; i += VELIKOST_KUSU) {
      var kus = bajty.subarray(i, i + VELIKOST_KUSU);
      binarniRetezec += String.fromCharCode.apply(null, kus);
    }
    return btoa(binarniRetezec);
  }

  // ---- nahrani/prepsani binarniho souboru v privatnim repu (pro budouci pouziti) ----

  function nahrajSoubor(cesta, blob, popis) {
    if (!zapisPovolen) {
      return Promise.resolve(false);
    }
    if (!blob || typeof blob.arrayBuffer !== "function") {
      return Promise.resolve(false);
    }
    var cestaApi = "contents/" + cesta;
    return blob
      .arrayBuffer()
      .then(function (bufferPole) {
        var obsahBase64 = arrayBufferNaBase64(bufferPole);
        // nejdriv zjistit sha existujiciho souboru (pokud existuje) - Contents API
        // vyzaduje sha pri prepisu, u noveho souboru sha vynechame
        return ghFetch("GET", cestaApi + "?ref=" + encodeURIComponent(KONFIG.vetev), null, {})
          .then(function (odpovedGet) {
            if (!odpovedGet.ok) {
              return null;
            }
            return odpovedGet.json().then(function (telo) {
              return telo.sha || null;
            });
          })
          .catch(function () {
            return null;
          })
          .then(function (sha) {
            var telo = {
              message: popis || "kokpit: nahrání souboru " + cesta,
              content: obsahBase64,
              branch: KONFIG.vetev
            };
            if (sha) {
              telo.sha = sha;
            }
            return ghFetch("PUT", cestaApi, telo, {});
          });
      })
      .then(function (odpovedPut) {
        if (!odpovedPut.ok) {
          return false;
        }
        cacheSouboru.delete(cesta); // zneplatnit cache - pri dalsim cteni se natahne cerstva verze
        return true;
      })
      .catch(function (chyba) {
        console.warn("GH.nahrajSoubor selhalo pro '" + cesta + "':", chyba);
        return false;
      });
  }

  // ---- GH.init: token drzet JEN v pameti ----

  function init(nastaveniInit) {
    tokenAktualni = (nastaveniInit && nastaveniInit.token) || null;
    zapisPovolen = !!(nastaveniInit && nastaveniInit.jeZapis);
  }

  return {
    init: init,
    nacti: nacti,
    nactiVse: nactiVse,
    zmen: zmen,
    spustPolling: spustPolling,
    chybejiciSoubory: chybejiciSoubory,
    zastavPolling: zastavPolling,
    noveId: noveId,
    nactiSoubor: nactiSoubor,
    nahrajSoubor: nahrajSoubor
  };
})();
