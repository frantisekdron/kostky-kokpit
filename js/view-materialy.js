/*
 * view-materialy.js — sekce "Materiály" (KONTRAKT.md §9.4 a §3.6) kokpitu
 * Pragerovy kostky.
 *
 * Sekce má tři vrstvy, seřazené podle toho, co je pro klienta důležité:
 *
 *   1. SHRNUTÍ SYROVÉHO MATERIÁLU — položky s `syrovy: true` (ruční záběry, dron,
 *      foto k výběru) jsou pracovní materiál ke střihu a PORR se nepředává. Nedávají
 *      se proto jako plné karty, ale do jednoho tichého rozklikávacího panelu
 *      s jednou větou ("Pracovní materiál z natáčení: … — celkem X GB. Nepředává se,
 *      slouží ke střihu."). Počty a velikosti počítá projetím složky s natáčením
 *      scripts/inventura.py — tady se JEN ZOBRAZUJÍ, nikdy nepřepisují.
 *   2. GALERIE NÁHLEDŮ — hlavní obsah sekce. Materiál s polem `galerie`
 *      [{nahled, velky, popisek, zarizeni}] se místo karty vykreslí jako mřížka
 *      náhledů (načítané postupně přes IntersectionObserver, stejně jako galerie
 *      náletu v sekci Časosběr), klik otevře snímek ve velkém v App.modal
 *      s pořadím, štítkem zařízení a přetáčením šipkami / klávesami ← →.
 *      Pod mřížkou je odkaz na plné rozlišení (MyAirBridge z položky).
 *   3. ZBYTEK — videa a ostatní materiály jako dosud: karty s Vimeo embedem
 *      (iframe se staví až na klik na "Přehrát", nikdy víc iframů najednou),
 *      řádkem MyAirBridge (odkaz, kopírování, štítek expirace), poznámkou
 *      a komentáři.
 *
 * ROZDĚLENÍ PODLE NÁVŠTĚV: celý obsah sekce (tichý panel pracovního materiálu,
 * galerie i karty) je seskupený podle pole `navsteva_id` a skupiny jdou po sobě
 * podle `cislo` návštěvy. Nadpis skupiny nese číslo, název a datum návštěvy
 * ("Návštěva č. 1 — Fáze 0 — výchozí stav · 26. 8. 2026"), pod ním souhrn
 * (kolik materiálů, kolik snímků v galeriích, kolik dat). Materiály bez
 * návštěvy (průběžná a souhrnné video) končí ve vlastní skupině úplně na konci,
 * pojmenované "Nepatří k žádné návštěvě". Filtry podle typu a stavu jsou nad
 * skupinami a — stejně jako dosud — se týkají jen karet, ne galerií a ne
 * pracovního materiálu; je to napsané i pod nimi, ať to nikoho nemate.
 *
 * NAHRÁVÁNÍ FOTEK PŘÍMO V APPCE — tlačítko "Nahrát fotky" u každé skupiny
 * návštěvy a v hlavičce sekce (tam s výběrem návštěvy). Cíl je VŽDY konkrétní
 * návštěva, nikdy "někam"; skupina "Nepatří k žádné návštěvě" proto tlačítko
 * nemá. Každá fotka se ještě v prohlížeči překreslí přes <canvas> na delší
 * hranu 1600 px a uloží jako JPEG (kvalita 0,82) — tím se z ní zároveň zahodí
 * EXIF včetně GPS souřadnic. To je záměr, ne vedlejší efekt: do repa nesmí
 * odejít souřadnice ani originály. Originály se nenahrávají NIKDY, repo na ně
 * není — ty jdou klientovi přes MyAirBridge a v dialogu se to říká rovnou.
 * Soubory putují do privátního repa přes GH.nahrajSoubor jeden po druhém do
 * "foto/materialy/<navsteva_id>/<nazev>-<poradi>.jpg" a teprve až jsou všechny
 * nahrané, zapíše se JEDNÍM GH.zmen celá dávka do `galerie` cílového materiálu
 * (víc zápisů = zbytečné commity, riziko souběhu a rychlejší cesta do limitu
 * API). GH.nahrajSoubor chyby polyká a vrací jen false, proto si tahle sekce
 * vede vlastní seznam neúspěšných souborů a vypíše ho jmenovitě. Fotky se
 * přidají do fotomateriálu dané návštěvy; když tam žádný není, založí se
 * (typ "foto-final"), když jich je víc, člověk si vybere. `pocet` materiálu se
 * po zápisu srovná na skutečnou délku galerie. Smí to jen role s právem
 * materialy.pridat / materialy.upravit — čtenář tlačítko vůbec nedostane.
 * V DEMU se nenahrává nic (GH.nahrajSoubor by bez tokenu střílel na GitHub):
 * fotky se jen zmenší a ukáže se souhrn, co by se bylo nahrálo.
 *
 * Pro práva materialy.pridat / materialy.upravit / materialy.smazat umožňuje
 * přidání, editaci a soft-delete. Pro právo komentare.pridat umožňuje komentáře
 * k materiálu (zapisují se přímo do aktivita.json, entita:"material"). Nahoře je
 * souhrn: celkový počet materiálů a součet velikostí (sečteno jen to, co jde
 * rozparsovat na GB/MB).
 *
 * Komentář může někoho OZNAČIT — pole `zminky` (pole os-id) v záznamu
 * aktivity. Označenému má po zápisu přijít upozornění na mail; rozesílá
 * ho GitHub Action nad datovým repem, appka mail odeslat neumí. Výběr lidí
 * staví společná Util.vyberZminek(), řádek pod komentářem Util.radekZminek().
 * Starší komentáře pole nemají — chybějící se bere jako prázdné (Util.zminky).
 *
 * Podle KONTRAKT_DODATEK.md (§B.1/§C.4): materiály s `prijemce:"Emauzy"` patří do
 * samostatné sekce "Materiál pro Emauzy" (js/view-emauzy.js) a v této sekci se
 * NEZOBRAZUJÍ (filtr `prijemce !== "Emauzy"`, chybějící hodnota = "PORR"). Formulář
 * editace/přidání proto obsahuje i pole "Příjemce" (PORR/Emauzy) — nově přidaný
 * materiál v TÉTO sekci má výchozí "PORR".
 *
 * Používá skutečné App.* API z js/app.js (App.polozky(soubor) pro čtení pole
 * položek, App.uloz(soubor, obsah) pro zápis celé obálky po GH.zmen — App.data
 * drží VŽDY celou obálku, nikdy se nesahá na App.data[soubor] přímo, viz
 * hlavičkový komentář js/app.js — dále App.modal({nadpis,obsah,akce}),
 * App.potvrd, App.toast, App.prekresli) a CSS
 * třídy již definované v styles.css (.karty-mrizka/.karta/.karta-hlavicka/
 * .karta-nadpis/.karta-meta/.karta-popis/.karta-akce, .nadpis-sekce/
 * .podnadpis-sekce/.oddil, .pole/.pole-radek, .prazdny-stav, .btn-primarni/
 * .btn-sekundarni/.btn-nebezpecny/.btn-mala, .stitek stav-<hodnota>) — přesný
 * seznam viz POZNAMKY_D-plan-materialy.md.
 *
 * Registruje se jako sekce 'materialy' přes App.registrujSekci('materialy', vykresli).
 * Čte App.polozky("materialy"/"navstevy"/"aktivita"), zapisuje přes GH.zmen('materialy', ...)
 * a GH.zmen('aktivita', ...).
 *
 * Vystavuje globální objekt `MaterialyUI` — sdílená stavebnice karet materiálu, aby
 * si ji sekce "Materiál pro Emauzy" (js/view-emauzy.js) nemusela duplikovat:
 *   MaterialyUI.karta(material)                        -> <article class="karta"> se
 *                                                          štítky, MyAirBridge řádkem,
 *                                                          Vimeo blokem, akcemi
 *                                                          (Upravit/Smazat podle práv)
 *                                                          a komentáři
 *   MaterialyUI.otevriFormular(material, prijemce)     -> modal editace; při přidávání
 *                                                          (material === null) je
 *                                                          druhý argument PŘEDNASTAVENÝ
 *                                                          příjemce ("PORR"/"Emauzy")
 *   MaterialyUI.komentare(entitaId)                    -> samostatný blok komentářů
 *   MaterialyUI.maGalerii(material)                    -> má materiál náhledy?
 *   MaterialyUI.galerie(material)                      -> celý blok galerie (nadpis,
 *                                                          filtr zařízení, mřížka
 *                                                          náhledů, odkaz ke stažení,
 *                                                          akce a komentáře) nebo null,
 *                                                          když materiál náhledy nemá
 *   MaterialyUI.zrusGalerie()                          -> odpojí IntersectionObservery
 *                                                          mřížek; volá se na začátku
 *                                                          vykreslení sekce
 *   MaterialyUI.TYPY / MaterialyUI.STAVY               -> popisky typů a stavů (kód → text)
 */

(function () {
  "use strict";

  var esc = Util.esc;
  var SOUBOR = "materialy";

  var TYP_MATERIALU = {
    "foto-raw": "Foto RAW",
    "foto-final": "Foto finální",
    "video-raw": "Video RAW",
    "video-strih": "Video střih",
    casosber: "Časosběr",
    dokument: "Dokument"
  };

  var STAV_MATERIALU = {
    syrove: "Syrové",
    "ve-zpracovani": "Ve zpracování",
    hotovo: "Hotovo",
    predano: "Předáno"
  };

  // filtry a otevrene komentare drzene v modulove uzaverce, at prezijou
  // prekresleni sekce (napr. po pollingu) bez resetovani
  var filtrTyp = "vse";
  var filtrStav = "vse";
  var otevreneKomentare = {};

  // ---------------------------------------------------------------------
  // Cteni App.data — App.data[soubor] drzi VZDY celou obalku {verze,...,
  // polozky} (viz js/app.js). Tenky obal nad spolecnym App.polozky().
  // ---------------------------------------------------------------------

  function ziskejPolozky(soubor) {
    return App.polozky(soubor);
  }

  function najdiPodleId(pole, id) {
    for (var i = 0; i < pole.length; i++) {
      if (pole[i].id === id) return pole[i];
    }
    return null;
  }

  function potvrdBezpecne(text) {
    if (window.App && typeof App.potvrd === "function") return Promise.resolve(App.potvrd(text));
    return Promise.resolve(window.confirm(text));
  }

  function formatGb(cislo) {
    var zaokrouhlene = Math.round(cislo * 10) / 10;
    var text = zaokrouhlene.toFixed(1).replace(".", ",");
    if (text.slice(-2) === ",0") text = text.slice(0, -2);
    return text + " GB";
  }

  // ---------------------------------------------------------------------
  // Stavebnice HTML formularovych poli (escapovane hodnoty)
  // ---------------------------------------------------------------------

  function poleHtml(jmeno, label, typ, hodnota) {
    var id = "pole-mat-" + jmeno;
    return (
      '<div class="pole">' +
      '<label for="' + id + '">' + esc(label) + "</label>" +
      '<input type="' + typ + '" id="' + id + '" name="' + jmeno + '" value="' + esc(hodnota || "") + '">' +
      "</div>"
    );
  }

  function poleTextareaHtml(jmeno, label, hodnota) {
    var id = "pole-mat-" + jmeno;
    return (
      '<div class="pole">' +
      '<label for="' + id + '">' + esc(label) + "</label>" +
      '<textarea id="' + id + '" name="' + jmeno + '" rows="3">' + esc(hodnota || "") + "</textarea></div>"
    );
  }

  function poleSelectHtml(jmeno, label, moznosti, vybrana) {
    var id = "pole-mat-" + jmeno;
    var opts = moznosti
      .map(function (m) {
        var sel = m[0] === vybrana ? " selected" : "";
        return '<option value="' + esc(m[0]) + '"' + sel + ">" + esc(m[1]) + "</option>";
      })
      .join("");
    return (
      '<div class="pole">' +
      '<label for="' + id + '">' + esc(label) + "</label>" +
      '<select id="' + id + '" name="' + jmeno + '">' + opts + "</select></div>"
    );
  }

  function poleCheckboxHtml(jmeno, label, zaskrtnuto) {
    var id = "pole-mat-" + jmeno;
    return (
      '<div class="pole-radek">' +
      '<input type="checkbox" id="' + id + '" name="' + jmeno + '"' +
      (zaskrtnuto ? " checked" : "") +
      ">" +
      '<label for="' + id + '">' + esc(label) + "</label></div>"
    );
  }

  // ---------------------------------------------------------------------
  // Komentare k materialu (aktivita.json, entita:"material")
  // ---------------------------------------------------------------------

  function vytvorKomentare(entitaId) {
    var vsechny = ziskejPolozky("aktivita");
    var komentare = vsechny
      .filter(function (a) {
        return a.entita === "material" && a.entita_id === entitaId && a.druh === "komentar" && !a.smazano;
      })
      .sort(function (a, b) {
        return a.kdy < b.kdy ? -1 : a.kdy > b.kdy ? 1 : 0;
      });

    var detail = document.createElement("details");
    detail.className = "komentare";
    detail.open = !!otevreneKomentare[entitaId];
    detail.addEventListener("toggle", function () {
      if (detail.open) {
        otevreneKomentare[entitaId] = true;
      } else {
        delete otevreneKomentare[entitaId];
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
        seznam.appendChild(vytvorKomentar(k));
      });
    }
    detail.appendChild(seznam);

    if (Auth.can("komentare.pridat")) {
      detail.appendChild(vytvorFormularKomentare(entitaId));
    }

    return detail;
  }

  function vytvorKomentar(k) {
    var wrap = document.createElement("div");
    wrap.className = "komentar";

    var hlavicka = document.createElement("p");
    hlavicka.className = "karta-meta";
    var autor = document.createElement("strong");
    autor.textContent = k.kdo;
    hlavicka.appendChild(autor);
    hlavicka.appendChild(document.createTextNode(" · " + Util.formatCas(k.kdy)));
    wrap.appendChild(hlavicka);

    var text = document.createElement("p");
    text.className = "karta-popis";
    text.textContent = k.text;
    wrap.appendChild(text);

    var radekZminek = Util.radekZminek(Util.zminky(k));
    if (radekZminek) wrap.appendChild(radekZminek);

    var muzeSmazat = Auth.can("komentare.smazat.cizi") || (Auth.ja && Auth.ja.id === k.kdo);
    if (muzeSmazat) {
      var smazat = document.createElement("button");
      smazat.type = "button";
      smazat.className = "btn btn-mala btn-sekundarni";
      smazat.textContent = "Smazat komentář";
      smazat.addEventListener("click", function () {
        smazatKomentar(k);
      });
      wrap.appendChild(smazat);
    }

    return wrap;
  }

  function smazatKomentar(komentar) {
    potvrdBezpecne("Smazat tento komentář?").then(function (ano) {
      if (!ano) return;
      GH.zmen("aktivita", function (polozky) {
        var p = najdiPodleId(polozky, komentar.id);
        if (p) p.smazano = { kdy: new Date().toISOString(), kdo: (Auth.ja && Auth.ja.osoba_id) || null };
      })
        .then(function (vysledek) {
          App.uloz("aktivita", vysledek);
          App.toast("Komentář smazán.", "ok");
          App.prekresli();
        })
        .catch(function (chyba) {
          App.toast((chyba && chyba.hlaska) || "Smazání komentáře selhalo.", "chyba");
        });
    });
  }

  function vytvorFormularKomentare(entitaId) {
    var form = document.createElement("form");
    form.className = "komentar-formular";

    var pole = document.createElement("div");
    pole.className = "pole";
    var textarea = document.createElement("textarea");
    textarea.rows = 2;
    textarea.name = "text";
    textarea.placeholder = "Napsat komentář k materiálu…";
    pole.appendChild(textarea);
    form.appendChild(pole);

    // Koho o komentáři upozornit mailem. Sebe si člověk neoznačuje.
    var vyberZminek = Util.vyberZminek({ vynech: (Auth.ja && Auth.ja.osoba_id) || null });
    form.appendChild(vyberZminek.prvek);

    var tlacitko = document.createElement("button");
    tlacitko.type = "submit";
    tlacitko.className = "btn btn-mala btn-primarni";
    tlacitko.textContent = "Přidat komentář";
    form.appendChild(tlacitko);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = textarea.value.trim();
      if (!text) return;
      tlacitko.disabled = true;
      GH.zmen("aktivita", function (polozky) {
        polozky.push({
          id: GH.noveId("akt"),
          entita: "material",
          entita_id: entitaId,
          druh: "komentar",
          text: text,
          zminky: vyberZminek.vybrane(),
          kdo: Auth.ja.id,
          kdy: new Date().toISOString(),
          smazano: null
        });
      })
        .then(function (vysledek) {
          App.uloz("aktivita", vysledek);
          otevreneKomentare[entitaId] = true;
          App.toast("Komentář přidán.", "ok");
          App.prekresli();
        })
        .catch(function (chyba) {
          App.toast((chyba && chyba.hlaska) || "Přidání komentáře selhalo.", "chyba");
          tlacitko.disabled = false;
        });
    });

    return form;
  }

  // ---------------------------------------------------------------------
  // MyAirBridge radek
  // ---------------------------------------------------------------------

  function vytvorMyAirBridgeRadek(m) {
    var radek = document.createElement("div");
    radek.className = "myairbridge-radek";

    var mab = m.myairbridge || {};
    if (!mab.url) {
      var prazdno = document.createElement("span");
      prazdno.className = "stitek";
      prazdno.textContent = "odkaz zatím nevyplněn";
      radek.appendChild(prazdno);
      return radek;
    }

    // Odkaz vyplnuje clovek — pustime dal jen http(s), at do href nespadne
    // "javascript:" (Util.bezpecnyOdkaz). Kdyz je adresa divna, misto
    // rozbiteho tlacitka ukazeme, ze je potreba ji opravit.
    var bezpecnaMab = Util.bezpecnyOdkaz(mab.url);
    if (!bezpecnaMab) {
      var vadna = document.createElement("span");
      vadna.className = "stitek stitek-chyba";
      vadna.textContent = "neplatný odkaz — musí začínat https://";
      radek.appendChild(vadna);
      return radek;
    }
    var odkaz = document.createElement("a");
    odkaz.href = bezpecnaMab;
    odkaz.target = "_blank";
    odkaz.rel = "noopener noreferrer";
    odkaz.className = "btn btn-mala btn-sekundarni";
    odkaz.textContent = "Otevřít";
    radek.appendChild(odkaz);

    var kopirovat = document.createElement("button");
    kopirovat.type = "button";
    kopirovat.className = "btn btn-mala btn-sekundarni";
    kopirovat.textContent = "Kopírovat odkaz";
    kopirovat.addEventListener("click", function () {
      Util.doSchranky(mab.url).then(function (ok) {
        App.toast(ok ? "Odkaz zkopírován." : "Kopírování selhalo.", ok ? "ok" : "chyba");
      });
    });
    radek.appendChild(kopirovat);

    if (mab.expiruje) {
      var dni = Util.zaDni(mab.expiruje);
      if (dni <= 14) {
        var stitekExp = document.createElement("span");
        stitekExp.className = "stitek";
        // cervene ohraniceni pres stejny mechanismus jako .stav-* tridy
        // (--stav-barva), viz POZNAMKY_D-plan-materialy.md
        stitekExp.style.setProperty("--stav-barva", "var(--chyba)");
        stitekExp.textContent = dni < 0 ? "vypršelo" : "expiruje " + Util.formatOdpocet(dni);
        radek.appendChild(stitekExp);
      }
    }

    if (mab.heslo_je) {
      var heslo = document.createElement("span");
      heslo.className = "stitek";
      heslo.textContent = "chráněno heslem";
      radek.appendChild(heslo);
    }

    return radek;
  }

  // ---------------------------------------------------------------------
  // Vimeo embed
  // ---------------------------------------------------------------------

  function parsujVimeo(url) {
    if (!url || typeof url !== "string") return null;
    var m;
    m = url.match(/player\.vimeo\.com\/video\/(\d+)(?:[?&]h=([a-zA-Z0-9]+))?/);
    if (m) return { id: m[1], hash: m[2] || null };
    m = url.match(/vimeo\.com\/channels\/[^/]+\/(\d+)(?:\/([a-zA-Z0-9]+))?/);
    if (m) return { id: m[1], hash: m[2] || null };
    m = url.match(/vimeo\.com\/(\d+)(?:\/([a-zA-Z0-9]+))?/);
    if (m) return { id: m[1], hash: m[2] || null };
    return null;
  }

  function vytvorVimeoBlok(m) {
    var vimeo = m.vimeo || {};
    if (!vimeo.url) return null;

    var blok = document.createElement("div");
    blok.className = "vimeo-blok";

    var rozparsovane = parsujVimeo(vimeo.url);
    if (!rozparsovane) {
      // Nerozpoznana adresa — nabidneme aspon odkaz, ale zase jen kdyz je
      // to http(s) (viz Util.bezpecnyOdkaz).
      var bezpecnaVimeo = Util.bezpecnyOdkaz(vimeo.url);
      if (!bezpecnaVimeo) {
        var vadnaV = document.createElement("span");
        vadnaV.className = "stitek stitek-chyba";
        vadnaV.textContent = "neplatný odkaz — musí začínat https://";
        blok.appendChild(vadnaV);
        return blok;
      }
      var odkaz = document.createElement("a");
      odkaz.href = bezpecnaVimeo;
      odkaz.target = "_blank";
      odkaz.rel = "noopener noreferrer";
      odkaz.className = "btn btn-mala btn-sekundarni";
      odkaz.textContent = "Vimeo odkaz →";
      blok.appendChild(odkaz);
      return blok;
    }

    var embedUrl =
      "https://player.vimeo.com/video/" + rozparsovane.id + (rozparsovane.hash ? "?h=" + rozparsovane.hash : "");

    var ratio = document.createElement("div");
    ratio.className = "vimeo-embed";

    var tlacitko = document.createElement("button");
    tlacitko.type = "button";
    tlacitko.className = "btn btn-mala btn-primarni vimeo-prehrat-tlacitko";
    tlacitko.textContent = "▶ Přehrát";
    tlacitko.addEventListener("click", function () {
      var iframe = document.createElement("iframe");
      iframe.src = embedUrl;
      iframe.setAttribute("allow", "autoplay; fullscreen; picture-in-picture");
      iframe.setAttribute("allowfullscreen", "");
      iframe.loading = "lazy";
      iframe.title = m.nazev || "Vimeo video";
      ratio.textContent = "";
      ratio.appendChild(iframe);
    });
    ratio.appendChild(tlacitko);
    blok.appendChild(ratio);

    return blok;
  }

  // ---------------------------------------------------------------------
  // GALERIE NÁHLEDŮ — hlavní obsah sekce
  //
  // Materiál může mít pole `galerie` = [{nahled, velky, popisek, zarizeni}].
  // Cesty jsou stejné jako u snímků z náletu ("foto/nalet/nahled/foto-01.jpg")
  // a načítají se úplně stejně jako v sekci Časosběr, tedy přes
  // GH.nactiSoubor(cesta) → v demu relativní cesta do seed/, v ostrém provozu
  // data: URL z privátního repa (dodatek §A.6). Kód se z js/view-casosber.js
  // převzít nedal — ten soubor si načítání drží v uzávěrce a nic nevystavuje —
  // takže je tady vlastní kopie stejného postupu (cache v paměti, jedno
  // ověření dostupnosti předem, IntersectionObserver).
  // ---------------------------------------------------------------------

  // cesta -> src (data: URL / relativní cesta) | null. Map, ne obyčejný objekt:
  // klíčem je cesta z dat a Map nemá prototypové klíče ("__proto__", …).
  var obrazkyVPameti = new Map();
  // cesta -> Promise<boolean>: jednorázové ověření, jestli se náhledy vůbec
  // načtou (na nasazeném demu složka seed/ není a bez tohohle by 40 dlaždic
  // vystřelilo 40 dotazů na 404, než se vrátí první chyba)
  var overeniPodleCesty = new Map();
  var pozorovateleNahledu = [];
  // id materiálu -> je jeho galerie rozbalená? (výchozí: sbalená na jednu řadu)
  var rozbaleneGalerie = {};

  function vetaOSnimcich(kolik) {
    if (kolik === 1) return "1 snímek";
    if (kolik >= 2 && kolik <= 4) return "všechny " + kolik + " snímky";
    return "všech " + kolik + " snímků";
  }

  // id materiálu -> vybrané zařízení ve filtru galerie ("vse" | hodnota)
  var filtrGalerie = {};

  // Hotový zdroj (relativní cesta do seed/, https odkaz, data: URL) se použije
  // rovnou; cesta do privátního repa jde přes GH.nactiSoubor. Díky tomu projdou
  // i náhledy, které scripts/emauzy_nahledy.py skládá do veřejného repa.
  function jePrimyZdroj(cesta) {
    return /^(seed\/|\.\/|https?:\/\/|data:)/.test(String(cesta || ""));
  }

  function zdrojProCestu(cesta) {
    if (!cesta) return Promise.resolve(null);
    if (jePrimyZdroj(cesta)) return Promise.resolve(cesta);
    if (!window.GH || typeof GH.nactiSoubor !== "function") return Promise.resolve(null);
    return Promise.resolve(GH.nactiSoubor(cesta));
  }

  // Normalizace položek galerie na jeden tvar {nahled, velky, popisek, zarizeni}.
  // Bere jak `galerie` (tvar dle zadání), tak `nahledy` [{cesta, popisek}], což je
  // tvar, který dnes zapisuje scripts/emauzy_nahledy.py — až se doplní fotky pro
  // klášter, sekce Emauzy je zobrazí bez další úpravy kódu.
  function polozkyGalerie(material) {
    if (!material) return [];
    var zdroj = Array.isArray(material.galerie)
      ? material.galerie
      : Array.isArray(material.nahledy) ? material.nahledy : [];
    var vysledek = [];
    zdroj.forEach(function (s) {
      if (!s) return;
      var nahled = typeof s.nahled === "string" && s.nahled ? s.nahled : s.cesta;
      if (typeof nahled !== "string" || !nahled) return;
      vysledek.push({
        nahled: nahled,
        velky: typeof s.velky === "string" && s.velky ? s.velky : nahled,
        popisek: typeof s.popisek === "string" ? s.popisek : "",
        zarizeni: typeof s.zarizeni === "string" ? s.zarizeni : ""
      });
    });
    return vysledek;
  }

  function maGalerii(material) {
    return polozkyGalerie(material).length > 0;
  }

  // ---- načítání jednoho náhledu ----

  function nahledSelhal(obrazek, stavovyPrvek) {
    obrazek.hidden = true;
    if (!stavovyPrvek) return;
    stavovyPrvek.hidden = false;
    stavovyPrvek.textContent =
      window.DEMO === true ? "Náhled je jen v lokálním demu." : "Náhled se nepodařilo načíst.";
  }

  function nactiObrazekDo(cesta, obrazek, stavovyPrvek, stavGalerie) {
    if (!cesta || !obrazek) return;
    if (stavGalerie && stavGalerie.nedostupne) {
      nahledSelhal(obrazek, stavovyPrvek);
      return;
    }

    function pouzij(src) {
      if (!src) {
        nahledSelhal(obrazek, stavovyPrvek);
        return;
      }
      // V demu je src relativní cesta do seed/ — soubor tam nemusí být
      // (nasazené demo na Pages seed/ nemá). Bez tohohle handleru by zůstal
      // jen rozbitý rámeček bez vysvětlení. Celou galerii odepíšeme JEN v demu,
      // kde chybí rovnou celá složka; v ostrém provozu má každý snímek dostat
      // vlastní pokus, jedna chybějící fotka nesmí zhasnout zbytek.
      obrazek.onerror = function () {
        obrazek.onerror = null;
        if (stavGalerie && window.DEMO === true) stavGalerie.nedostupne = true;
        nahledSelhal(obrazek, stavovyPrvek);
      };
      obrazek.src = src;
      obrazek.hidden = false;
      if (stavovyPrvek) stavovyPrvek.hidden = true;
    }

    if (obrazkyVPameti.has(cesta)) {
      pouzij(obrazkyVPameti.get(cesta));
      return;
    }
    zdrojProCestu(cesta)
      .then(function (src) {
        obrazkyVPameti.set(cesta, src || null);
        pouzij(src);
      })
      .catch(function (chyba) {
        console.warn("Materiály — načtení náhledu selhalo:", cesta, chyba);
        obrazkyVPameti.set(cesta, null);
        pouzij(null);
      });
  }

  // Jedno ověření dopředu: zkusí se první cesta a teprve podle výsledku se
  // pustí mřížka. Výsledek se drží podle cesty, takže překreslení sekce
  // (změna filtru, polling) už neověřuje znovu.
  function overNahledy(cesta) {
    if (overeniPodleCesty.has(cesta)) return overeniPodleCesty.get(cesta);
    var slib = zdrojProCestu(cesta)
      .then(function (src) {
        if (!src) return false;
        obrazkyVPameti.set(cesta, src);
        return new Promise(function (hotovo) {
          var zkouska = new Image();
          zkouska.onload = function () {
            hotovo(true);
          };
          zkouska.onerror = function () {
            hotovo(false);
          };
          zkouska.src = src;
        });
      })
      .catch(function () {
        return false;
      });
    overeniPodleCesty.set(cesta, slib);
    return slib;
  }

  function spustPozorovani(kNacteni, stavGalerie) {
    if (typeof window.IntersectionObserver !== "function") {
      // starý prohlížeč: mřížka je konečná, načteme rovnou
      kNacteni.forEach(function (z) {
        nactiObrazekDo(z.cesta, z.obrazek, z.stav, stavGalerie);
      });
      return;
    }
    var podleElementu = new Map();
    var pozorovatel = new window.IntersectionObserver(
      function (zaznamy, ten) {
        zaznamy.forEach(function (zaznam) {
          if (!zaznam.isIntersecting) return;
          var data = podleElementu.get(zaznam.target);
          ten.unobserve(zaznam.target);
          if (data) nactiObrazekDo(data.cesta, data.obrazek, data.stav, stavGalerie);
        });
      },
      { rootMargin: "300px 0px" }
    );
    kNacteni.forEach(function (z) {
      podleElementu.set(z.prvek, z);
      pozorovatel.observe(z.prvek);
    });
    pozorovateleNahledu.push(pozorovatel);
  }

  function zapniPozorovatele(kNacteni, stavGalerie) {
    if (!kNacteni.length) return;
    overNahledy(kNacteni[0].cesta).then(function (dostupne) {
      stavGalerie.nedostupne = !dostupne;
      spustPozorovani(kNacteni, stavGalerie);
    });
  }

  // Volá se na začátku vykreslení sekce (i ze sekce Emauzy přes
  // MaterialyUI.zrusGalerie), ať po překreslení nezůstanou viset pozorovatelé
  // nad zahozenými dlaždicemi.
  function zrusPozorovatele() {
    pozorovateleNahledu.forEach(function (p) {
      try {
        p.disconnect();
      } catch (chyba) {
        console.warn("Materiály — úklid pozorovatele selhal:", chyba);
      }
    });
    pozorovateleNahledu = [];
  }

  // ---- prohlížeč snímku v modálu ----

  function otevriProhlizec(snimky, index, nazevGalerie) {
    if (!snimky.length) return null;
    var aktualni = ((index % snimky.length) + snimky.length) % snimky.length;
    var tokenNacteni = 0;

    var obsah = document.createElement("div");
    obsah.className = "detail-snimku";

    var obalObrazku = document.createElement("div");
    obalObrazku.className = "detail-obrazek";
    var obrazek = document.createElement("img");
    obrazek.alt = "";
    obrazek.decoding = "async";
    obrazek.hidden = true;
    obalObrazku.appendChild(obrazek);
    var stavObrazku = document.createElement("p");
    stavObrazku.className = "cas-foto-stav";
    obalObrazku.appendChild(stavObrazku);
    obsah.appendChild(obalObrazku);

    var poradi = document.createElement("p");
    poradi.className = "karta-meta";
    obsah.appendChild(poradi);

    var popisekEl = document.createElement("p");
    popisekEl.className = "karta-popis";
    obsah.appendChild(popisekEl);

    var stitky = document.createElement("div");
    stitky.className = "dlazdice-stitky";
    var stitekZarizeni = document.createElement("span");
    stitekZarizeni.className = "stitek stitek-zarizeni";
    stitky.appendChild(stitekZarizeni);
    obsah.appendChild(stitky);

    function zobraz(novyIndex) {
      aktualni = ((novyIndex % snimky.length) + snimky.length) % snimky.length;
      var snimek = snimky[aktualni];

      poradi.textContent = "Snímek " + (aktualni + 1) + " ze " + snimky.length;
      popisekEl.textContent = snimek.popisek || "";
      popisekEl.hidden = !snimek.popisek;
      stitekZarizeni.textContent = snimek.zarizeni || "";
      stitky.hidden = !snimek.zarizeni;

      obrazek.hidden = true;
      obrazek.removeAttribute("src");
      stavObrazku.hidden = false;
      stavObrazku.textContent = "Načítám snímek…";

      tokenNacteni += 1;
      var muj = tokenNacteni;
      zdrojProCestu(snimek.velky)
        .then(function (src) {
          if (muj !== tokenNacteni) return; // mezitím se přepnulo na jiný snímek
          if (!src) {
            stavObrazku.textContent =
              window.DEMO === true ? "Snímek je jen v lokálním demu." : "Snímek se nepodařilo načíst.";
            return;
          }
          obrazek.onerror = function () {
            obrazek.onerror = null;
            if (muj !== tokenNacteni) return;
            obrazek.hidden = true;
            stavObrazku.hidden = false;
            stavObrazku.textContent =
              window.DEMO === true ? "Snímek je jen v lokálním demu." : "Snímek se nepodařilo načíst.";
          };
          obrazek.src = src;
          obrazek.hidden = false;
          stavObrazku.hidden = true;
        })
        .catch(function (chyba) {
          if (muj !== tokenNacteni) return;
          console.warn("Materiály — velký snímek selhal:", chyba);
          stavObrazku.textContent = "Snímek se nepodařilo načíst.";
        });
    }

    // Šipky přetáčejí dokola, takže nikdy nevznikne mrtvé neaktivní tlačítko.
    function posun(o) {
      zobraz(aktualni + o);
    }

    function naKlavesu(e) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        posun(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        posun(1);
      }
    }

    var kontejnerModalu = document.getElementById("modal-kontejner");

    var modal = App.modal({
      nadpis: nazevGalerie || "Galerie",
      obsah: obsah,
      naZavreni: function () {
        document.removeEventListener("keydown", naKlavesu);
        tokenNacteni += 1; // ať doběhlé načtení už nesahá na zahozený DOM
        if (kontejnerModalu) kontejnerModalu.classList.remove("modal-siroky");
      },
      akce: [
        { text: "← Předchozí", druh: "sekundarni", fn: function () { posun(-1); } },
        { text: "Další →", druh: "sekundarni", fn: function () { posun(1); } },
        { text: "Zavřít", druh: "primarni", fn: function () { modal.zavri(); } }
      ]
    });

    // stejně jako detail snímku v Časosběru je i tenhle modal široký
    if (kontejnerModalu) kontejnerModalu.classList.add("modal-siroky");
    document.addEventListener("keydown", naKlavesu);

    zobraz(aktualni);
    return modal;
  }

  // ---- dlaždice a mřížka ----

  function vytvorDlazdiciGalerie(snimek, cislo, kNacteni, stavGalerie, naKlik) {
    var dlazdice = document.createElement("button");
    dlazdice.type = "button";
    dlazdice.className = "dlazdice";
    dlazdice.setAttribute(
      "aria-label",
      "Snímek " + cislo + (snimek.zarizeni ? ", " + snimek.zarizeni : "")
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
    // ať dlaždice neproblikává na „…".
    if (obrazkyVPameti.has(snimek.nahled)) {
      nactiObrazekDo(snimek.nahled, obrazek, stav, stavGalerie);
    } else {
      kNacteni.push({ prvek: ramecek, cesta: snimek.nahled, obrazek: obrazek, stav: stav });
    }

    var info = document.createElement("span");
    info.className = "dlazdice-info";

    var prvniRadek = document.createElement("span");
    prvniRadek.className = "dlazdice-radek";
    prvniRadek.textContent = "#" + cislo;
    info.appendChild(prvniRadek);

    if (snimek.popisek) {
      var druhyRadek = document.createElement("span");
      druhyRadek.className = "dlazdice-radek dlazdice-slaby";
      druhyRadek.textContent = snimek.popisek;
      info.appendChild(druhyRadek);
    }

    if (snimek.zarizeni) {
      var stitkyEl = document.createElement("span");
      stitkyEl.className = "dlazdice-stitky";
      var stitekZarizeni = document.createElement("span");
      stitekZarizeni.className = "stitek stitek-zarizeni";
      stitekZarizeni.textContent = snimek.zarizeni;
      stitkyEl.appendChild(stitekZarizeni);
      info.appendChild(stitkyEl);
    }

    dlazdice.appendChild(info);
    dlazdice.addEventListener("click", naKlik);
    return dlazdice;
  }

  // ---- popisky ----

  // 1 snímek · 2–4 snímky · 5+ snímků — bez tohohle by v UI stálo „1 snímků".
  function sklonuj(pocet, jedna, dvaAzCtyri, pet) {
    if (pocet === 1) return jedna;
    if (pocet >= 2 && pocet <= 4) return dvaAzCtyri;
    return pet;
  }

  // Datum se bere z návštěvy, ke které je materiál navázaný — nikde se
  // nehardcoduje.
  function datumMaterialu(material) {
    if (!material || !material.navsteva_id) return "";
    var navsteva = najdiPodleId(ziskejPolozky("navstevy"), material.navsteva_id);
    if (!navsteva || !navsteva.datum) return "";
    return Util.formatDatum(navsteva.datum, navsteva.datum_presnost || "presne");
  }

  function vetaOGalerii(material, pocet) {
    var jeFinal = material.typ === "foto-final";
    var veta = pocet + " ";
    if (jeFinal) veta += sklonuj(pocet, "finální ", "finální ", "finálních ");
    veta += sklonuj(pocet, "snímek", "snímky", "snímků");
    var datum = datumMaterialu(material);
    if (datum) veta += " z " + datum;
    return veta + ".";
  }

  function velkePrvni(text) {
    var t = String(text || "");
    if (!t) return t;
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // ---- celý blok galerie ----

  function vytvorGaleriiMaterialu(material) {
    var vsechnySnimky = polozkyGalerie(material);
    if (!vsechnySnimky.length) return null;

    var blok = document.createElement("section");
    blok.className = "oddil";
    var stavGalerie = { nedostupne: false };

    var hlava = document.createElement("div");
    hlava.className = "sekce-hlavicka";
    var nadpis = document.createElement("h3");
    nadpis.className = "podnadpis-sekce";
    nadpis.textContent = material.nazev || "Galerie";
    hlava.appendChild(nadpis);
    var meta = document.createElement("span");
    meta.className = "karta-meta";
    meta.textContent = vetaOGalerii(material, vsechnySnimky.length);
    hlava.appendChild(meta);
    blok.appendChild(hlava);

    // Poznámka jde pod nadpis jako tichý podtitulek — větu o počtu snímků už
    // nese hlavička, tohle k ní jen doplňuje detaily (rozlišení, čím se točilo).
    if (material.poznamka) {
      var pozn = document.createElement("p");
      pozn.className = "karta-meta";
      pozn.style.margin = "-8px 0 12px";
      pozn.textContent = material.poznamka;
      blok.appendChild(pozn);
    }

    // Filtr podle zařízení — jen když je v galerii opravdu z čeho vybírat.
    var zarizeni = [];
    vsechnySnimky.forEach(function (s) {
      if (s.zarizeni && zarizeni.indexOf(s.zarizeni) === -1) zarizeni.push(s.zarizeni);
    });

    var vybrane = filtrGalerie[material.id] || "vse";
    if (zarizeni.indexOf(vybrane) === -1) vybrane = "vse";

    var snimky = vsechnySnimky.filter(function (s) {
      return vybrane === "vse" || s.zarizeni === vybrane;
    });

    if (zarizeni.length > 1) {
      var pruh = document.createElement("div");
      pruh.className = "galerie-filtr";
      pruh.setAttribute("role", "group");
      pruh.setAttribute("aria-label", "Filtr snímků podle zařízení");

      var moznosti = [{ kod: "vse", nazev: "Vše", pocet: vsechnySnimky.length }].concat(
        zarizeni.map(function (z) {
          return {
            kod: z,
            nazev: velkePrvni(z),
            pocet: vsechnySnimky.filter(function (s) {
              return s.zarizeni === z;
            }).length
          };
        })
      );

      moznosti.forEach(function (m) {
        var tlacitko = document.createElement("button");
        tlacitko.type = "button";
        tlacitko.className = "filtr-tlacitko" + (m.kod === vybrane ? " filtr-tlacitko-aktivni" : "");
        tlacitko.textContent = m.nazev + " (" + m.pocet + ")";
        tlacitko.setAttribute("aria-pressed", m.kod === vybrane ? "true" : "false");
        tlacitko.addEventListener("click", function () {
          if (filtrGalerie[material.id] === m.kod) return;
          filtrGalerie[material.id] = m.kod;
          App.prekresli();
        });
        pruh.appendChild(tlacitko);
      });
      blok.appendChild(pruh);
    }

    var mrizka = document.createElement("div");
    mrizka.className = "galerie-mrizka";
    var kNacteni = [];
    snimky.forEach(function (snimek, i) {
      // Číslo dlaždice = pořadí v tom, co je právě vidět, tedy totéž, co pak
      // v prohlížeči hlásí "snímek 7 ze 40". Při zapnutém filtru se čísluje
      // i prochází jen vyfiltrovaná část, ať si čísla neodporují.
      mrizka.appendChild(
        vytvorDlazdiciGalerie(snimek, i + 1, kNacteni, stavGalerie, function () {
          otevriProhlizec(snimky, i, material.nazev);
        })
      );
    });
    // Galerie se ukazuje SBALENÁ na jednu řadu. U čtyřiceti snímků z jednoho
    // natáčení by jinak karta zabrala celou obrazovku a materiály pod ní by
    // nikdo nenašel. Sbalení je čistě přes mřížku (první řada `auto`, další
    // nulové a oříznuté), takže se počet dlaždic v řadě řídí šířkou okna —
    // na mobilu jich je míň než na monitoru — a náhledy z dalších řad se
    // ani nezačnou stahovat, dokud je člověk nerozbalí (pozorovatel je
    // nevidí, protože jsou oříznuté na nulovou výšku).
    var jeRozbalena = !!rozbaleneGalerie[material.id];
    if (!jeRozbalena) mrizka.classList.add("galerie-mrizka-sbalena");
    blok.appendChild(mrizka);

    if (snimky.length > 1) {
      var prepinac = document.createElement("button");
      prepinac.type = "button";
      prepinac.className = "btn btn-mala btn-sekundarni galerie-vic";
      prepinac.textContent = jeRozbalena
        ? "Sbalit zpátky na jednu řadu"
        : "Zobrazit " + vetaOSnimcich(snimky.length);
      prepinac.setAttribute("aria-expanded", jeRozbalena ? "true" : "false");
      prepinac.addEventListener("click", function () {
        rozbaleneGalerie[material.id] = !jeRozbalena;
        App.prekresli();
      });
      blok.appendChild(prepinac);
    }

    // načítání náhledů až ve chvíli, kdy dlaždice doroluje do výřezu
    window.setTimeout(function () {
      zapniPozorovatele(kNacteni, stavGalerie);
    }, 0);

    var popisekStazeni = document.createElement("p");
    popisekStazeni.className = "karta-meta";
    popisekStazeni.style.marginTop = "14px";
    popisekStazeni.textContent =
      "Plné rozlišení ke stažení" + (material.velikost && material.velikost !== "—" ? " (" + material.velikost + ")" : "");
    blok.appendChild(popisekStazeni);
    blok.appendChild(vytvorMyAirBridgeRadek(material));

    if (Auth.can("materialy.upravit") || Auth.can("materialy.smazat")) {
      var akce = document.createElement("div");
      akce.className = "karta-akce";
      if (Auth.can("materialy.upravit")) {
        var upravit = document.createElement("button");
        upravit.type = "button";
        upravit.className = "btn btn-mala btn-sekundarni";
        upravit.textContent = "Upravit";
        upravit.addEventListener("click", function () {
          otevriFormularMaterialu(material);
        });
        akce.appendChild(upravit);
      }
      if (Auth.can("materialy.smazat")) {
        var smazat = document.createElement("button");
        smazat.type = "button";
        smazat.className = "btn btn-mala btn-nebezpecny";
        smazat.textContent = "Smazat";
        smazat.addEventListener("click", function () {
          smazatMaterial(material);
        });
        akce.appendChild(smazat);
      }
      blok.appendChild(akce);
    }

    blok.appendChild(vytvorKomentare(material.id));

    return blok;
  }

  // ---------------------------------------------------------------------
  // SYROVÝ MATERIÁL — jen okrajové shrnutí, detail až na rozkliknutí
  //
  // Položky s `syrovy: true` jsou pracovní materiál ke střihu, PORR se
  // nepředává. Nedávají se proto jako plné karty, ale do tichého panelu
  // v čele skupiny své návštěvy. Počty a velikosti udržuje scripts/inventura.py
  // projetím složky s natáčením — v UI se jen zobrazují, nikdy nepřepisují.
  //
  // Otevřenost panelu se drží PODLE SKUPINY (klíč = id návštěvy, resp.
  // "__bez__"), aby rozkliknutí u jedné návštěvy neotevřelo panely u všech.
  // ---------------------------------------------------------------------

  var syroveOtevrene = {};

  function popisSyroveho(m) {
    var nazev = m.nazev || "materiál";
    var pocet = m.pocet;
    if (typeof pocet !== "number" || !isFinite(pocet) || pocet <= 0) return nazev;
    var jeFoto = String(m.typ || "").indexOf("foto") === 0;
    var jednotka = jeFoto
      ? sklonuj(pocet, "snímek", "snímky", "snímků")
      : sklonuj(pocet, "klip", "klipy", "klipů");
    return nazev + " (" + pocet + " " + jednotka + ")";
  }

  function vetaOSyrovem(syrove) {
    var soucetGb = 0;
    var mameVelikost = false;
    syrove.forEach(function (m) {
      var gb = Util.velikostNaGb(m.velikost);
      if (gb !== null) {
        soucetGb += gb;
        mameVelikost = true;
      }
    });
    var veta = "Pracovní materiál z natáčení: " + syrove.map(popisSyroveho).join(" · ");
    if (mameVelikost) veta += " — celkem " + formatGb(soucetGb);
    return veta + ". Nepředává se, slouží ke střihu.";
  }

  function vytvorSouhrnSyroveho(syrove, klicSkupiny) {
    if (!syrove.length) return null;
    var klic = klicSkupiny || "__vse__";

    var oddil = document.createElement("section");
    oddil.className = "oddil";

    // .harmonogram-panel / -summary / -telo je v styles.css tichý rozklikávací
    // panel (summary má min-height 44 px kvůli dotyku). Levá linka je tam modrá
    // „citace od PORR" — tady je to náš vlastní text, tak se ztlumí na --linka.
    var panel = document.createElement("details");
    panel.className = "harmonogram-panel";
    panel.style.borderLeftColor = "var(--linka)";
    panel.open = syroveOtevrene[klic] === true;
    panel.addEventListener("toggle", function () {
      syroveOtevrene[klic] = panel.open;
    });

    var shrnuti = document.createElement("summary");
    shrnuti.className = "harmonogram-summary";
    shrnuti.style.alignItems = "flex-start";
    shrnuti.style.padding = "10px 0";
    shrnuti.style.fontWeight = "600";
    shrnuti.style.fontSize = "0.86rem";
    shrnuti.style.lineHeight = "1.45";
    shrnuti.style.color = "var(--text-slaby)";
    shrnuti.textContent = vetaOSyrovem(syrove);
    panel.appendChild(shrnuti);

    var telo = document.createElement("div");
    telo.className = "harmonogram-telo";
    var mrizka = document.createElement("div");
    mrizka.className = "karty-mrizka";
    syrove.forEach(function (m) {
      mrizka.appendChild(vytvorKartu(m));
    });
    telo.appendChild(mrizka);
    panel.appendChild(telo);

    oddil.appendChild(panel);
    return oddil;
  }

  // ---------------------------------------------------------------------
  // Editace / pridani / soft-delete materialu
  // ---------------------------------------------------------------------

  // vychoziPrijemce se uplatni JEN u noveho materialu (material === null) — sekce
  // "Materiál pro Emauzy" tudy predava "Emauzy", sekce Materialy "PORR" (dodatek §B.2).
  function otevriFormularMaterialu(material, vychoziPrijemce) {
    var jeNovy = !material;
    var prijemceProFormular = material
      ? material.prijemce || "PORR"
      : vychoziPrijemce === "Emauzy" ? "Emauzy" : "PORR";
    var navstevy = ziskejPolozky("navstevy")
      .filter(function (n) {
        return !n.smazano;
      })
      .sort(function (a, b) {
        return (a.cislo || 0) - (b.cislo || 0);
      });

    var navstevaMoznosti = [["", "— bez návštěvy —"]].concat(
      navstevy.map(function (n) {
        return [n.id, "Natáčení č. " + n.cislo + " — " + n.nazev];
      })
    );

    var form = document.createElement("form");
    form.innerHTML =
      poleHtml("nazev", "Název", "text", material ? material.nazev : "") +
      poleSelectHtml(
        "typ",
        "Typ",
        Object.keys(TYP_MATERIALU).map(function (k) {
          return [k, TYP_MATERIALU[k]];
        }),
        material ? material.typ : "foto-raw"
      ) +
      poleSelectHtml(
        "stav",
        "Stav",
        Object.keys(STAV_MATERIALU).map(function (k) {
          return [k, STAV_MATERIALU[k]];
        }),
        material ? material.stav : "syrove"
      ) +
      poleSelectHtml("navsteva_id", "Návštěva", navstevaMoznosti, material ? material.navsteva_id || "" : "") +
      '<div class="pole-radek">' +
      poleHtml(
        "pocet",
        "Počet",
        "number",
        material && material.pocet !== null && material.pocet !== undefined ? material.pocet : ""
      ) +
      poleHtml("velikost", "Velikost", "text", material ? material.velikost : "") +
      "</div>" +
      poleTextareaHtml("poznamka", "Poznámka", material ? material.poznamka : "") +
      poleSelectHtml(
        "prijemce",
        "Příjemce",
        [
          ["PORR", "PORR"],
          ["Emauzy", "Emauzy"]
        ],
        prijemceProFormular
      ) +
      poleHtml("mab_url", "MyAirBridge — odkaz", "text", material && material.myairbridge ? material.myairbridge.url : "") +
      poleHtml(
        "mab_expiruje",
        "MyAirBridge — expiruje",
        "date",
        material && material.myairbridge ? material.myairbridge.expiruje : ""
      ) +
      poleCheckboxHtml(
        "mab_heslo",
        "MyAirBridge — chráněno heslem",
        material && material.myairbridge ? material.myairbridge.heslo_je : false
      ) +
      poleHtml("vimeo_url", "Vimeo — odkaz", "text", material && material.vimeo ? material.vimeo.url : "");

    var handle;

    function pokusUlozit() {
      var data = nacistFormularMaterialu(form);
      if (!data) return;
      // Odkazy pustime dal jen kdyz jsou http(s) — at se "javascript:" vubec
      // neulozi do dat, nejen at se nevykresli (Util.bezpecnyOdkaz).
      var kontrolaOdkazu = [
        { hodnota: data.myairbridge && data.myairbridge.url, nazev: "MyAirBridge" },
        { hodnota: data.vimeo && data.vimeo.url, nazev: "Vimeo" }
      ];
      for (var i = 0; i < kontrolaOdkazu.length; i++) {
        var k = kontrolaOdkazu[i];
        if (k.hodnota && !Util.bezpecnyOdkaz(k.hodnota)) {
          App.toast("Odkaz " + k.nazev + " musí začínat https://", "chyba");
          return;
        }
      }
      ulozitMaterial(jeNovy, material, data).then(function (ok) {
        if (ok) handle.zavri();
      });
    }

    var akce = [{ text: "Zrušit", druh: "sekundarni", fn: function () { handle.zavri(); } }];
    if (!jeNovy) {
      akce.push({
        text: "Smazat (do koše)",
        druh: "nebezpecny",
        fn: function () {
          handle.zavri();
          smazatMaterial(material);
        }
      });
    }
    akce.push({ text: jeNovy ? "Přidat materiál" : "Uložit", druh: "primarni", fn: pokusUlozit });

    handle = App.modal({
      nadpis: jeNovy
        ? prijemceProFormular === "Emauzy" ? "Nový materiál pro Emauzy" : "Nový materiál"
        : "Upravit materiál: " + material.nazev,
      obsah: form,
      akce: akce
    });
  }

  function nacistFormularMaterialu(form) {
    var nazev = form.elements["nazev"].value.trim();
    if (!nazev) {
      App.toast("Vyplň název materiálu.", "chyba");
      return null;
    }
    var pocetHodnota = form.elements["pocet"].value;
    return {
      nazev: nazev,
      typ: form.elements["typ"].value,
      stav: form.elements["stav"].value,
      navsteva_id: form.elements["navsteva_id"].value || null,
      pocet: pocetHodnota === "" ? null : parseInt(pocetHodnota, 10),
      velikost: form.elements["velikost"].value.trim(),
      poznamka: form.elements["poznamka"].value.trim(),
      prijemce: form.elements["prijemce"].value,
      myairbridge: {
        url: form.elements["mab_url"].value.trim(),
        expiruje: form.elements["mab_expiruje"].value || null,
        heslo_je: form.elements["mab_heslo"].checked
      },
      vimeo: {
        url: form.elements["vimeo_url"].value.trim()
      }
    };
  }

  function ulozitMaterial(jeNovy, material, data) {
    return GH.zmen(
      SOUBOR,
      function (polozky) {
        if (jeNovy) {
          polozky.push(Object.assign({}, data, { id: GH.noveId("mat"), smazano: null }));
        } else {
          var p = najdiPodleId(polozky, material.id);
          if (!p) throw new Error("Materiál nenalezen.");
          Object.assign(p, data);
        }
      },
      (jeNovy ? 'Přidán materiál "' : 'Upraven materiál "') + data.nazev + '".'
    )
      .then(function (vysledek) {
        App.uloz("materialy", vysledek);
        App.toast(jeNovy ? "Materiál přidán." : "Materiál upraven.", "ok");
        App.prekresli();
        return true;
      })
      .catch(function (chyba) {
        App.toast((chyba && chyba.hlaska) || "Uložení materiálu selhalo.", "chyba");
        return false;
      });
  }

  function smazatMaterial(material) {
    potvrdBezpecne('Poslat materiál "' + material.nazev + '" do koše?').then(function (ano) {
      if (!ano) return;
      GH.zmen(
        SOUBOR,
        function (polozky) {
          var p = najdiPodleId(polozky, material.id);
          if (p) p.smazano = { kdy: new Date().toISOString(), kdo: (Auth.ja && Auth.ja.osoba_id) || null };
        },
        'Smazán materiál "' + material.nazev + '".'
      )
        .then(function (vysledek) {
          App.uloz("materialy", vysledek);
          App.toast("Materiál poslán do koše.", "ok");
          App.prekresli();
        })
        .catch(function (chyba) {
          App.toast((chyba && chyba.hlaska) || "Smazání materiálu selhalo.", "chyba");
        });
    });
  }

  // ---------------------------------------------------------------------
  // NAHRÁVÁNÍ FOTEK PŘÍMO Z APPKY
  //
  // Fotka se PŘED odesláním překreslí přes <canvas> na delší hranu 1600 px
  // a uloží jako JPEG (kvalita 0,82). Překreslení má dva důvody a oba jsou
  // záměrné:
  //   1. do repa jde pár set kB místo desítek megabajtů — repo na originály
  //      není, ty putují klientovi přes MyAirBridge,
  //   2. canvas zahodí VŠECHNA EXIF metadata včetně GPS souřadnic, takže
  //      z fotky nikdy neodejde do repa, kde přesně kdo stál.
  // Originál se neodesílá nikdy a člověk se to dozví přímo v dialogu.
  //
  // Cesta v privátním repu: foto/materialy/<navsteva_id>/<nazev>-<poradi>.jpg
  // (název očištěný o diakritiku a mezery, ať nevznikají divné cesty).
  // ---------------------------------------------------------------------

  var MAX_HRANA_PX = 1600;
  var KVALITA_JPEG = 0.82;
  var SLOZKA_FOTEK = "foto/materialy/";
  var HODNOTA_NOVY_MATERIAL = "__novy__";

  function jeDemoRezim() {
    return typeof window !== "undefined" && window.DEMO === true;
  }

  // Chyba s polem `hlaska` — App.toast ji umí vypsat člověku. Mutátor, který
  // svůj cíl nenajde, MUSÍ vyhodit tohle a ne jen `return`: tichý no-op by
  // zvedl verzi souboru a člověk by viděl falešné „Uloženo." (vzor viz
  // chybaProUzivatele() v js/view-pripominky.js).
  function chybaProUzivatele(text) {
    var chyba = new Error(text);
    chyba.hlaska = text;
    return chyba;
  }

  function smiNahravat() {
    return Auth.can("materialy.pridat") || Auth.can("materialy.upravit");
  }

  // Název materiálu → kus cesty v repu: bez diakritiky, bez mezer, jen [a-z0-9-].
  // Bez toho by z „Foto — návštěva č. 1" vznikla cesta s diakritikou a mezerami,
  // kterou pak nikdo pořádně neotevře.
  function ocistiProCestu(text) {
    var zaklad = String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+/, "")
      .slice(0, 40)
      .replace(/-+$/, "");
    return zaklad || "foto";
  }

  function cislujNaTri(cislo) {
    var text = String(cislo);
    while (text.length < 3) text = "0" + text;
    return text;
  }

  function bezPripony(nazevSouboru) {
    var text = String(nazevSouboru || "").trim();
    var tecka = text.lastIndexOf(".");
    return tecka > 0 ? text.slice(0, tecka) : text;
  }

  // Aby nová fotka nepřepsala starší soubor se stejnou cestou, hledá se
  // nejvyšší už použité pořadí pro tenhle základ názvu a pokračuje se za ním.
  function dalsiPoradiVGalerii(material, zaklad) {
    if (!material) return 1;
    var nejvyssi = 0;
    var vzor = new RegExp("(?:^|/)" + zaklad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-(\\d+)\\.jpg$", "i");
    polozkyGalerie(material).forEach(function (snimek) {
      var shoda = vzor.exec(snimek.nahled || "");
      if (!shoda) return;
      var cislo = parseInt(shoda[1], 10);
      if (isFinite(cislo) && cislo > nejvyssi) nejvyssi = cislo;
    });
    return nejvyssi + 1;
  }

  function formatBajty(bajtu) {
    var cislo = Number(bajtu) || 0;
    if (cislo >= 1048576) {
      return (Math.round((cislo / 1048576) * 10) / 10).toFixed(1).replace(".", ",") + " MB";
    }
    return Math.max(1, Math.round(cislo / 1024)) + " kB";
  }

  function vetaOFotkach(pocet) {
    if (pocet === 1) return "1 fotka";
    if (pocet >= 2 && pocet <= 4) return pocet + " fotky";
    return pocet + " fotek";
  }

  // ---- zmenšení jedné fotky přes canvas (a tím i zahození EXIF/GPS) ----

  function zmensiObrazek(soubor) {
    return new Promise(function (splneno, selhalo) {
      if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
        selhalo(new Error("prohlížeč neumí otevřít soubor"));
        return;
      }
      var adresa = URL.createObjectURL(soubor);
      var obrazek = new Image();

      // Prohlížeč sám otočí fotku podle EXIF orientace (image-orientation:
      // from-image je dnes výchozí), takže naturalWidth/naturalHeight už jsou
      // po otočení a canvas kreslí fotku nastojato i z mobilu.
      obrazek.onload = function () {
        URL.revokeObjectURL(adresa);
        var sirkaZdroje = obrazek.naturalWidth || obrazek.width;
        var vyskaZdroje = obrazek.naturalHeight || obrazek.height;
        if (!sirkaZdroje || !vyskaZdroje) {
          selhalo(new Error("soubor nevypadá jako obrázek"));
          return;
        }
        var pomer = Math.min(1, MAX_HRANA_PX / Math.max(sirkaZdroje, vyskaZdroje));
        var sirka = Math.max(1, Math.round(sirkaZdroje * pomer));
        var vyska = Math.max(1, Math.round(vyskaZdroje * pomer));

        var platno = document.createElement("canvas");
        platno.width = sirka;
        platno.height = vyska;
        var kresba = platno.getContext ? platno.getContext("2d") : null;
        if (!kresba || typeof platno.toBlob !== "function") {
          selhalo(new Error("prohlížeč neumí zmenšit obrázek"));
          return;
        }
        // Bílé pozadí: průhlednost z PNG by se do JPEG propsala černě.
        kresba.fillStyle = "#ffffff";
        kresba.fillRect(0, 0, sirka, vyska);
        kresba.drawImage(obrazek, 0, 0, sirka, vyska);

        platno.toBlob(
          function (blob) {
            if (blob) splneno({ blob: blob, sirka: sirka, vyska: vyska });
            else selhalo(new Error("převod na JPEG selhal"));
          },
          "image/jpeg",
          KVALITA_JPEG
        );
      };
      obrazek.onerror = function () {
        URL.revokeObjectURL(adresa);
        selhalo(new Error("soubor se nepodařilo otevřít jako obrázek"));
      };
      obrazek.src = adresa;
    });
  }

  // ---- dávka: zmenšit a nahrát soubor po souboru ----
  //
  // Postupně, ne najednou — desítky paralelních PUTů by zbytečně bušily do API
  // a držely v paměti všechny fotky zároveň. Vrácená Promise se NIKDY neodmítne:
  // výsledek je {hotove, selhane}, protože GH.nahrajSoubor chyby polyká a vrací
  // jen false; bez vlastního seznamu by selhání jednoho souboru zapadlo.
  function zpracujFotky(soubory, kontext, hlasStav) {
    var hotove = [];
    var selhane = [];
    var index = 0;

    function dalsi() {
      if (index >= soubory.length) {
        return Promise.resolve({ hotove: hotove, selhane: selhane });
      }
      var soubor = soubory[index];
      var poradiVDavce = index + 1;
      hlasStav("Zmenšuji " + poradiVDavce + " z " + soubory.length + "…");
      return zmensiObrazek(soubor)
        .then(function (vysledek) {
          var cesta =
            kontext.slozka + kontext.zaklad + "-" + cislujNaTri(kontext.poradi + hotove.length) + ".jpg";
          var zaznam = {
            cesta: cesta,
            popisek: bezPripony(soubor.name),
            sirka: vysledek.sirka,
            vyska: vysledek.vyska,
            bajtu: vysledek.blob.size,
            puvodnichBajtu: soubor.size || 0
          };
          if (jeDemoRezim()) {
            // V demu se opravdu jen zmenšuje — na síť se nesahá (viz hlavička).
            hotove.push(zaznam);
            return null;
          }
          hlasStav("Nahrávám " + poradiVDavce + " z " + soubory.length + "…");
          return GH.nahrajSoubor(cesta, vysledek.blob, kontext.popisZapisu).then(function (proslo) {
            if (proslo) hotove.push(zaznam);
            else selhane.push(soubor.name + " — nahrání do repa selhalo");
          });
        })
        .catch(function (chyba) {
          selhane.push(soubor.name + " — " + ((chyba && chyba.message) || "zpracování selhalo"));
        })
        .then(function () {
          index++;
          return dalsi();
        });
    }

    return dalsi();
  }

  // ---- jediný zápis do materialy.json až po nahrání celé dávky ----

  function zapisFotkyDoDat(jeNovy, cilovyMaterial, nazevCile, navstevaId, hotove) {
    var noveSnimky = hotove.map(function (h) {
      // Nahrává se jedna velikost (1600 px), takže náhled i „velký" míří na
      // tentýž soubor. Popisek = původní název souboru, ať se dá snímek spárovat
      // s originálem na MyAirBridge.
      return { nahled: h.cesta, velky: h.cesta, popisek: h.popisek, zarizeni: "" };
    });

    return GH.zmen(
      SOUBOR,
      function (polozky) {
        var cil;
        if (jeNovy) {
          cil = {
            id: GH.noveId("mat"),
            navsteva_id: navstevaId,
            prijemce: "PORR",
            nazev: nazevCile,
            typ: "foto-final",
            stav: "ve-zpracovani",
            pocet: 0,
            velikost: "",
            myairbridge: { url: "", expiruje: null, heslo_je: false },
            vimeo: { url: "" },
            poznamka:
              "Fotky nahrané přímo v kokpitu — zmenšené náhledy (delší hrana " +
              MAX_HRANA_PX +
              " px). Plné rozlišení patří na MyAirBridge.",
            galerie: [],
            smazano: null
          };
          polozky.push(cil);
        } else {
          cil = najdiPodleId(polozky, cilovyMaterial.id);
          if (!cil) {
            throw chybaProUzivatele(
              'Materiál "' +
                cilovyMaterial.nazev +
                '" už v datech není. Fotky jsou nahrané v repu, ale nemám je kam zapsat — ' +
                "založ materiál znovu a fotky do něj přidej."
            );
          }
        }
        // Materiál od scripts/emauzy_nahledy.py má místo `galerie` pole `nahledy`.
        // Převedeme ho na `galerie` (jinak by se nové snímky schovaly za starý
        // tvar), původní pole ale necháváme být — nic se neztratí.
        if (!Array.isArray(cil.galerie)) {
          cil.galerie = polozkyGalerie(cil);
        }
        cil.galerie = cil.galerie.concat(noveSnimky);
        cil.pocet = cil.galerie.length;
      },
      'Do materiálu "' + nazevCile + '" nahráno: ' + vetaOFotkach(noveSnimky.length) + "."
    );
  }

  // ---- fotomateriály jedné návštěvy (kam se dá dávka přidat) ----

  function fotoMaterialyNavstevy(navstevaId) {
    return ziskejPolozky("materialy").filter(function (m) {
      return (
        m &&
        !m.smazano &&
        m.prijemce !== "Emauzy" &&
        m.syrovy !== true &&
        m.navsteva_id === navstevaId &&
        String(m.typ || "").indexOf("foto") === 0
      );
    });
  }

  // Výchozí návštěva v hlavičkovém dialogu: poslední, jejíž datum už bylo
  // (z té se fotky nejspíš vezou), jinak ta úplně první.
  function vychoziNavstevaId(navstevy) {
    var dnes = new Date().toISOString().slice(0, 10);
    var vybrana = null;
    navstevy.forEach(function (n) {
      if (n.datum && n.datum <= dnes) vybrana = n;
    });
    return (vybrana || navstevy[0]).id;
  }

  // ---- dialog ----

  function otevriNahravaniFotek(navstevaIdParam) {
    if (!smiNahravat()) {
      App.toast("Na nahrávání fotek nemáš právo.", "chyba");
      return;
    }
    var navstevy = ziskejPolozky("navstevy")
      .filter(function (n) {
        return !n.smazano;
      })
      .sort(function (a, b) {
        return (a.cislo || 0) - (b.cislo || 0);
      });
    if (!navstevy.length) {
      App.toast("Fotky se nahrávají vždy do návštěvy — zatím tu žádná není.", "chyba");
      return;
    }
    var vybranaNavsteva = navstevaIdParam || vychoziNavstevaId(navstevy);
    if (!najdiPodleId(navstevy, vybranaNavsteva)) {
      App.toast("Návštěva už v datech není. Načti stránku znovu.", "chyba");
      return;
    }

    var form = document.createElement("form");
    form.className = "nahravani-fotek";
    form.addEventListener("submit", function (udalost) {
      udalost.preventDefault();
    });

    var vysvetleni = document.createElement("p");
    vysvetleni.className = "nahravani-vysvetleni";
    vysvetleni.textContent =
      "Každá fotka se ještě tady v prohlížeči zmenší na delší hranu " +
      MAX_HRANA_PX +
      " px a uloží jako JPEG. Překreslením se z ní zahodí i EXIF včetně GPS souřadnic — " +
      "do repa tedy neodejde, kde se stálo. Originály se nenahrávají nikdy, na ty je MyAirBridge.";
    form.appendChild(vysvetleni);

    // ---- návštěva (u skupiny je daná, v hlavičce se vybírá) ----
    var poleNavstevy = document.createElement("div");
    poleNavstevy.className = "pole";
    var popisekNavstevy = document.createElement("label");
    popisekNavstevy.textContent = "Návštěva";
    poleNavstevy.appendChild(popisekNavstevy);
    if (navstevaIdParam) {
      var textNavstevy = document.createElement("p");
      textNavstevy.className = "nahravani-cil";
      textNavstevy.textContent = nazevSkupinyNavstevy(najdiPodleId(navstevy, vybranaNavsteva));
      poleNavstevy.appendChild(textNavstevy);
    } else {
      popisekNavstevy.setAttribute("for", "pole-nahrat-navsteva");
      var vyberNavstevy = document.createElement("select");
      vyberNavstevy.id = "pole-nahrat-navsteva";
      navstevy.forEach(function (n) {
        var moznost = document.createElement("option");
        moznost.value = n.id;
        moznost.textContent = nazevSkupinyNavstevy(n);
        if (n.id === vybranaNavsteva) moznost.selected = true;
        vyberNavstevy.appendChild(moznost);
      });
      vyberNavstevy.addEventListener("change", function () {
        vybranaNavsteva = vyberNavstevy.value;
        prekresliCil();
      });
      poleNavstevy.appendChild(vyberNavstevy);
    }
    form.appendChild(poleNavstevy);

    // ---- kam fotky přidat (přestavuje se při změně návštěvy) ----
    var obalCile = document.createElement("div");
    form.appendChild(obalCile);
    var vyberCile = null;
    var poleNazvu = null;

    function prekresliCil() {
      while (obalCile.firstChild) obalCile.removeChild(obalCile.firstChild);
      var navsteva = najdiPodleId(navstevy, vybranaNavsteva);
      var kandidati = Auth.can("materialy.upravit") ? fotoMaterialyNavstevy(vybranaNavsteva) : [];

      var poleCile = document.createElement("div");
      poleCile.className = "pole";
      var popisekCile = document.createElement("label");
      popisekCile.setAttribute("for", "pole-nahrat-cil");
      popisekCile.textContent = "Kam fotky přidat";
      poleCile.appendChild(popisekCile);

      vyberCile = document.createElement("select");
      vyberCile.id = "pole-nahrat-cil";
      kandidati.forEach(function (m) {
        var moznost = document.createElement("option");
        moznost.value = m.id;
        var pocetSnimku = polozkyGalerie(m).length;
        moznost.textContent =
          m.nazev +
          (pocetSnimku
            ? " (" + pocetSnimku + " " + sklonuj(pocetSnimku, "snímek", "snímky", "snímků") + ")"
            : " (zatím bez snímků)");
        vyberCile.appendChild(moznost);
      });
      if (Auth.can("materialy.pridat")) {
        var moznostNovy = document.createElement("option");
        moznostNovy.value = HODNOTA_NOVY_MATERIAL;
        moznostNovy.textContent = "— založit nový materiál —";
        vyberCile.appendChild(moznostNovy);
      }
      poleCile.appendChild(vyberCile);
      obalCile.appendChild(poleCile);

      var poleNazvuObal = document.createElement("div");
      poleNazvuObal.className = "pole";
      var popisekNazvu = document.createElement("label");
      popisekNazvu.setAttribute("for", "pole-nahrat-nazev");
      popisekNazvu.textContent = "Název nového materiálu";
      poleNazvuObal.appendChild(popisekNazvu);
      poleNazvu = document.createElement("input");
      poleNazvu.type = "text";
      poleNazvu.id = "pole-nahrat-nazev";
      poleNazvu.value = "Foto — návštěva č. " + ((navsteva && navsteva.cislo) || "?");
      poleNazvuObal.appendChild(poleNazvu);
      obalCile.appendChild(poleNazvuObal);

      function prepniNazev() {
        poleNazvuObal.hidden = vyberCile.value !== HODNOTA_NOVY_MATERIAL;
      }
      vyberCile.addEventListener("change", prepniNazev);
      prepniNazev();

      if (!vyberCile.options.length) {
        poleCile.hidden = true;
        poleNazvuObal.hidden = true;
        var nic = document.createElement("p");
        nic.className = "nahravani-cil";
        nic.textContent =
          "K téhle návštěvě zatím není žádný fotomateriál a založit nový nemáš právo. " +
          "Ať ho někdo s právem přidávat založí, pak sem fotky půjdou.";
        obalCile.appendChild(nic);
      }
    }
    prekresliCil();

    // ---- soubory ----
    var poleSouboru = document.createElement("div");
    poleSouboru.className = "pole";
    var popisekSouboru = document.createElement("label");
    popisekSouboru.setAttribute("for", "pole-nahrat-soubory");
    popisekSouboru.textContent = "Fotky (dá se vybrat víc najednou)";
    poleSouboru.appendChild(popisekSouboru);
    var vstupSouboru = document.createElement("input");
    vstupSouboru.type = "file";
    vstupSouboru.id = "pole-nahrat-soubory";
    vstupSouboru.accept = "image/*";
    vstupSouboru.multiple = true;
    poleSouboru.appendChild(vstupSouboru);
    form.appendChild(poleSouboru);

    if (jeDemoRezim()) {
      var demoRadek = document.createElement("p");
      demoRadek.className = "nahravani-demo";
      demoRadek.textContent =
        "Demo: fotky se jen zmenší tady v prohlížeči a ukáže se souhrn, co by se bylo nahrálo. " +
        "Nikam se nic neodesílá a do dat se nic nezapíše — demo nemá přístup k datovému repu.";
      form.appendChild(demoRadek);
    }

    var stavovyRadek = document.createElement("p");
    stavovyRadek.className = "nahravani-stav";
    stavovyRadek.setAttribute("role", "status");
    stavovyRadek.setAttribute("aria-live", "polite");
    form.appendChild(stavovyRadek);

    var obalSouhrnu = document.createElement("div");
    form.appendChild(obalSouhrnu);

    function hlasStav(text) {
      stavovyRadek.textContent = text || "";
    }

    vstupSouboru.addEventListener("change", function () {
      var pocet = (vstupSouboru.files || []).length;
      while (obalSouhrnu.firstChild) obalSouhrnu.removeChild(obalSouhrnu.firstChild);
      hlasStav(pocet ? "Vybráno " + pocet + " " + sklonuj(pocet, "soubor", "soubory", "souborů") + "." : "");
    });

    // Souhrn po doběhnutí dávky — kolik prošlo, kolik ne a které konkrétně.
    function vypisSouhrn(hotove, selhane, jeDemoDavka) {
      while (obalSouhrnu.firstChild) obalSouhrnu.removeChild(obalSouhrnu.firstChild);

      var uvod = document.createElement("p");
      uvod.className = selhane.length ? "nahravani-souhrn nahravani-souhrn-chyba" : "nahravani-souhrn";
      var vety = [];
      if (jeDemoDavka) {
        vety.push("Demo — nic se neodeslalo.");
        vety.push("Zmenšeno: " + vetaOFotkach(hotove.length) + ".");
      } else {
        vety.push("Nahráno: " + vetaOFotkach(hotove.length) + ".");
      }
      if (selhane.length) vety.push("Neprošlo: " + vetaOFotkach(selhane.length) + ".");
      uvod.textContent = vety.join(" ");
      obalSouhrnu.appendChild(uvod);

      if (jeDemoDavka && hotove.length) {
        var seznamDemo = document.createElement("ul");
        seznamDemo.className = "nahravani-seznam";
        hotove.forEach(function (h) {
          var radek = document.createElement("li");
          radek.textContent =
            h.cesta +
            " — " +
            h.sirka +
            " × " +
            h.vyska +
            " px, " +
            formatBajty(h.bajtu) +
            (h.puvodnichBajtu ? " (originál " + formatBajty(h.puvodnichBajtu) + ")" : "");
          seznamDemo.appendChild(radek);
        });
        obalSouhrnu.appendChild(seznamDemo);
      }

      if (selhane.length) {
        var seznamChyb = document.createElement("ul");
        seznamChyb.className = "nahravani-seznam nahravani-seznam-chyba";
        selhane.forEach(function (popis) {
          var radek = document.createElement("li");
          radek.textContent = popis;
          seznamChyb.appendChild(radek);
        });
        obalSouhrnu.appendChild(seznamChyb);
      }
    }

    var probiha = false;
    var handle;

    function spustit() {
      if (probiha) return;
      if (!vyberCile || !vyberCile.options.length) {
        App.toast("Není kam fotky přidat.", "chyba");
        return;
      }
      var soubory = Array.prototype.slice.call(vstupSouboru.files || []);
      if (!soubory.length) {
        App.toast("Vyber aspoň jednu fotku.", "chyba");
        return;
      }

      var jeNovy = vyberCile.value === HODNOTA_NOVY_MATERIAL;
      if (jeNovy && !Auth.can("materialy.pridat")) {
        App.toast("Na založení nového materiálu nemáš právo.", "chyba");
        return;
      }
      if (!jeNovy && !Auth.can("materialy.upravit")) {
        App.toast("Na úpravu materiálu nemáš právo.", "chyba");
        return;
      }

      var cilovyMaterial = null;
      if (!jeNovy) {
        cilovyMaterial = najdiPodleId(ziskejPolozky("materialy"), vyberCile.value);
        if (!cilovyMaterial) {
          App.toast("Vybraný materiál už v datech není. Načti stránku znovu.", "chyba");
          return;
        }
      }
      var nazevCile = jeNovy ? poleNazvu.value.trim() : cilovyMaterial.nazev;
      if (!nazevCile) {
        App.toast("Vyplň název nového materiálu.", "chyba");
        return;
      }

      var navstevaId = vybranaNavsteva;
      var zaklad = ocistiProCestu(nazevCile);
      var kontext = {
        slozka: SLOZKA_FOTEK + ocistiProCestu(navstevaId) + "/",
        zaklad: zaklad,
        poradi: dalsiPoradiVGalerii(cilovyMaterial, zaklad),
        popisZapisu: "kokpit: fotky k návštěvě " + navstevaId
      };

      probiha = true;
      while (obalSouhrnu.firstChild) obalSouhrnu.removeChild(obalSouhrnu.firstChild);

      zpracujFotky(soubory, kontext, hlasStav).then(function (vysledek) {
        var hotove = vysledek.hotove;
        var selhane = vysledek.selhane;

        if (jeDemoRezim()) {
          probiha = false;
          hlasStav("");
          vypisSouhrn(hotove, selhane, true);
          return;
        }
        if (!hotove.length) {
          probiha = false;
          hlasStav("");
          vypisSouhrn(hotove, selhane, false);
          App.toast("Nenahrála se ani jedna fotka.", "chyba");
          return;
        }

        hlasStav("Zapisuji do dat…");
        zapisFotkyDoDat(jeNovy, cilovyMaterial, nazevCile, navstevaId, hotove)
          .then(function (obsah) {
            probiha = false;
            App.uloz(SOUBOR, obsah);
            App.toast("Nahráno: " + vetaOFotkach(hotove.length) + ".", "ok");
            if (selhane.length) {
              // Část dávky neprošla — dialog necháváme otevřený, ať si člověk
              // přečte, které soubory to byly.
              hlasStav("");
              vypisSouhrn(hotove, selhane, false);
            } else {
              handle.zavri();
            }
            App.prekresli();
          })
          .catch(function (chyba) {
            probiha = false;
            hlasStav("Fotky jsou nahrané v repu, ale zápis do dat selhal.");
            vypisSouhrn(hotove, selhane, false);
            App.toast((chyba && chyba.hlaska) || "Zápis fotek do dat selhal.", "chyba");
          });
      });
    }

    handle = App.modal({
      nadpis: "Nahrát fotky",
      obsah: form,
      akce: [
        {
          text: "Zavřít",
          druh: "sekundarni",
          fn: function () {
            if (probiha) {
              App.toast("Nahrávání ještě běží — počkej, až doběhne.", "info");
              return;
            }
            handle.zavri();
          }
        },
        { text: "Nahrát fotky", druh: "primarni", fn: spustit }
      ]
    });
  }

  // ---------------------------------------------------------------------
  // Filtry a seskupeni
  // ---------------------------------------------------------------------

  function projdeFiltrem(m) {
    if (filtrTyp !== "vse" && m.typ !== filtrTyp) return false;
    if (filtrStav !== "vse" && m.stav !== filtrStav) return false;
    return true;
  }

  // Klíč skupiny pro materiály, které k žádné návštěvě nepatří (průběžná
  // a souhrnné video). Není to id návštěvy, takže se s ničím nesrazí.
  var KLIC_BEZ_NAVSTEVY = "__bez__";

  // "Návštěva č. 1 — Fáze 0 — výchozí stav · 26. 8. 2026". Datum se bere
  // z návštěvy i s její přesností, nikde se nehardcoduje.
  function nazevSkupinyNavstevy(navsteva) {
    if (!navsteva) return "Návštěva";
    var text = "Návštěva č. " + (navsteva.cislo || "?") + " — " + (navsteva.nazev || "bez názvu");
    var datum = navsteva.datum
      ? Util.formatDatum(navsteva.datum, navsteva.datum_presnost || "presne", navsteva.datum_do || null)
      : "";
    return datum ? text + " · " + datum : text;
  }

  function souhrnSkupiny(materialy) {
    var pocetSnimku = 0;
    var soucetGb = 0;
    var mameVelikost = false;
    materialy.forEach(function (m) {
      pocetSnimku += polozkyGalerie(m).length;
      var gb = Util.velikostNaGb(m.velikost);
      if (gb !== null) {
        soucetGb += gb;
        mameVelikost = true;
      }
    });
    var casti = [
      materialy.length + " " + sklonuj(materialy.length, "materiál", "materiály", "materiálů")
    ];
    if (pocetSnimku) {
      casti.push(pocetSnimku + " " + sklonuj(pocetSnimku, "snímek", "snímky", "snímků") + " v galerii");
    }
    if (mameVelikost) casti.push("celkem " + formatGb(soucetGb));
    return casti.join(" · ");
  }

  // Materiály -> skupiny podle `navsteva_id`, seřazené podle `cislo` návštěvy.
  // Vrací [{klic, navsteva|null, nazev, materialy}]. Pořadí na konci:
  // nejdřív návštěvy, pak materiály odkazující na návštěvu, která už v datech
  // není (ať se neztratí), a úplně nakonec ty, co k žádné návštěvě nepatří.
  function seskupitPodleNavstevy(materialy, navstevy) {
    var skupiny = {};
    materialy.forEach(function (m) {
      var klic = m.navsteva_id || KLIC_BEZ_NAVSTEVY;
      if (!skupiny[klic]) skupiny[klic] = [];
      skupiny[klic].push(m);
    });

    var vysledek = [];
    var pouzite = {};
    navstevy
      .slice()
      .sort(function (a, b) {
        return (a.cislo || 0) - (b.cislo || 0);
      })
      .forEach(function (n) {
        if (!skupiny[n.id]) return;
        vysledek.push({
          klic: n.id,
          navsteva: n,
          nazev: nazevSkupinyNavstevy(n),
          materialy: skupiny[n.id]
        });
        pouzite[n.id] = true;
      });

    Object.keys(skupiny).forEach(function (klic) {
      if (klic === KLIC_BEZ_NAVSTEVY || pouzite[klic]) return;
      vysledek.push({
        klic: klic,
        navsteva: null,
        nazev: "Návštěva, která už v datech není (" + klic + ")",
        materialy: skupiny[klic]
      });
    });

    if (skupiny[KLIC_BEZ_NAVSTEVY]) {
      vysledek.push({
        klic: KLIC_BEZ_NAVSTEVY,
        navsteva: null,
        nazev: "Nepatří k žádné návštěvě",
        materialy: skupiny[KLIC_BEZ_NAVSTEVY]
      });
    }
    return vysledek;
  }

  function vytvorSelectFiltr(label, moznosti, vybrana, naZmenu) {
    var wrap = document.createElement("div");
    wrap.className = "pole";
    var lbl = document.createElement("label");
    lbl.textContent = label;
    wrap.appendChild(lbl);
    var select = document.createElement("select");
    moznosti.forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m[0];
      opt.textContent = m[1];
      if (m[0] === vybrana) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", function () {
      naZmenu(select.value);
    });
    wrap.appendChild(select);
    return wrap;
  }

  function vytvorFiltry(kontejner) {
    var radek = document.createElement("div");
    radek.className = "pole-radek";

    var typMoznosti = [["vse", "Vše"]].concat(
      Object.keys(TYP_MATERIALU).map(function (k) {
        return [k, TYP_MATERIALU[k]];
      })
    );
    radek.appendChild(
      vytvorSelectFiltr("Typ", typMoznosti, filtrTyp, function (hodnota) {
        filtrTyp = hodnota;
        vykresli(kontejner);
      })
    );

    var stavMoznosti = [["vse", "Vše"]].concat(
      Object.keys(STAV_MATERIALU).map(function (k) {
        return [k, STAV_MATERIALU[k]];
      })
    );
    radek.appendChild(
      vytvorSelectFiltr("Stav", stavMoznosti, filtrStav, function (hodnota) {
        filtrStav = hodnota;
        vykresli(kontejner);
      })
    );

    return radek;
  }

  // ---------------------------------------------------------------------
  // Vykresleni
  // ---------------------------------------------------------------------

  function vytvorHlavicku(materialy, navstevy) {
    var oddil = document.createElement("section");
    oddil.className = "oddil";

    var h2 = document.createElement("h2");
    h2.className = "nadpis-sekce";
    h2.textContent = "Materiály";
    oddil.appendChild(h2);

    var soucetGb = 0;
    materialy.forEach(function (m) {
      var gb = Util.velikostNaGb(m.velikost);
      if (gb !== null) soucetGb += gb;
    });
    var souhrn = document.createElement("p");
    souhrn.className = "podnadpis-sekce";
    souhrn.textContent = materialy.length + " materiálů · celkem " + formatGb(soucetGb);
    oddil.appendChild(souhrn);

    var akce = document.createElement("div");
    akce.className = "karta-akce";

    if (Auth.can("materialy.pridat")) {
      var pridat = document.createElement("button");
      pridat.type = "button";
      pridat.className = "btn btn-primarni";
      pridat.textContent = "+ Přidat materiál";
      pridat.addEventListener("click", function () {
        otevriFormularMaterialu(null, "PORR");
      });
      akce.appendChild(pridat);
    }

    // Nahrávání z hlavičky sekce míří do návštěvy vybrané v dialogu — tím
    // jdou fotky i k návštěvě, která zatím žádný materiál nemá (a nemá tedy
    // ani vlastní skupinu s tlačítkem).
    if (smiNahravat() && navstevy.length) {
      var nahrat = document.createElement("button");
      nahrat.type = "button";
      nahrat.className = "btn btn-sekundarni";
      nahrat.textContent = "Nahrát fotky";
      nahrat.addEventListener("click", function () {
        otevriNahravaniFotek(null);
      });
      akce.appendChild(nahrat);
    }

    if (akce.childNodes.length) oddil.appendChild(akce);

    return oddil;
  }

  function vytvorKartu(m) {
    var karta = document.createElement("article");
    karta.className = "karta stav-" + m.stav;

    var hl = document.createElement("div");
    hl.className = "karta-hlavicka";
    var nazev = document.createElement("h3");
    nazev.className = "karta-nadpis";
    nazev.textContent = m.nazev;
    hl.appendChild(nazev);
    var stitky = document.createElement("div");
    stitky.style.display = "flex";
    stitky.style.gap = "6px";
    stitky.style.flexWrap = "wrap";
    var typStitek = document.createElement("span");
    typStitek.className = "stitek";
    typStitek.textContent = TYP_MATERIALU[m.typ] || m.typ;
    stitky.appendChild(typStitek);
    var stavStitek = document.createElement("span");
    stavStitek.className = "stitek stav-" + m.stav;
    stavStitek.textContent = STAV_MATERIALU[m.stav] || m.stav;
    stitky.appendChild(stavStitek);
    hl.appendChild(stitky);
    karta.appendChild(hl);

    var meta = document.createElement("p");
    meta.className = "karta-meta";
    var casti = [];
    if (m.pocet !== null && m.pocet !== undefined && m.pocet !== "") casti.push(m.pocet + " ks");
    if (m.velikost) casti.push(m.velikost);
    meta.textContent = casti.length ? casti.join(" · ") : "—";
    karta.appendChild(meta);

    if (m.poznamka) {
      var pozn = document.createElement("p");
      pozn.className = "karta-popis";
      pozn.textContent = m.poznamka;
      karta.appendChild(pozn);
    }

    karta.appendChild(vytvorMyAirBridgeRadek(m));

    var vimeoBlok = vytvorVimeoBlok(m);
    if (vimeoBlok) karta.appendChild(vimeoBlok);

    if (Auth.can("materialy.upravit") || Auth.can("materialy.smazat")) {
      var akce = document.createElement("div");
      akce.className = "karta-akce";
      if (Auth.can("materialy.upravit")) {
        var upravit = document.createElement("button");
        upravit.type = "button";
        upravit.className = "btn btn-mala btn-sekundarni";
        upravit.textContent = "Upravit";
        upravit.addEventListener("click", function () {
          otevriFormularMaterialu(m);
        });
        akce.appendChild(upravit);
      }
      if (Auth.can("materialy.smazat")) {
        var smazat = document.createElement("button");
        smazat.type = "button";
        smazat.className = "btn btn-mala btn-nebezpecny";
        smazat.textContent = "Smazat";
        smazat.addEventListener("click", function () {
          smazatMaterial(m);
        });
        akce.appendChild(smazat);
      }
      karta.appendChild(akce);
    }

    karta.appendChild(vytvorKomentare(m.id));

    return karta;
  }

  // ---------------------------------------------------------------------
  // Jedna skupina = jedna návštěva. Uvnitř zůstává pořadí vrstev, na které
  // je sekce zvyklá: tichý panel pracovního materiálu, pak galerie náhledů,
  // pak karty (ty jediné projdou filtrem typu/stavu). Vrací null, když ve
  // skupině po filtru nic nezbylo — prázdné nadpisy tu nikoho nezajímají.
  // ---------------------------------------------------------------------

  function vytvorSkupinu(sk) {
    var syrove = sk.materialy.filter(function (m) {
      return m.syrovy === true;
    });
    var galerijni = sk.materialy.filter(function (m) {
      return m.syrovy !== true && maGalerii(m);
    });
    var karty = sk.materialy
      .filter(function (m) {
        return m.syrovy !== true && !maGalerii(m);
      })
      .filter(projdeFiltrem);

    if (!syrove.length && !galerijni.length && !karty.length) return null;

    var oddil = document.createElement("section");
    oddil.className = "oddil skupina-navstevy";

    var hlava = document.createElement("div");
    hlava.className = "skupina-navstevy-hlavicka";

    var texty = document.createElement("div");
    texty.className = "skupina-navstevy-texty";
    var nadpis = document.createElement("h3");
    nadpis.className = "skupina-navstevy-nadpis";
    nadpis.textContent = sk.nazev;
    texty.appendChild(nadpis);
    var souhrn = document.createElement("p");
    souhrn.className = "skupina-navstevy-souhrn";
    souhrn.textContent = souhrnSkupiny(sk.materialy);
    texty.appendChild(souhrn);
    hlava.appendChild(texty);

    // Nahrávat jde jen do konkrétní návštěvy — skupina "Nepatří k žádné
    // návštěvě" (a skupina po smazané návštěvě) tlačítko nedostane.
    if (sk.navsteva && smiNahravat()) {
      var nahrat = document.createElement("button");
      nahrat.type = "button";
      nahrat.className = "btn btn-mala btn-sekundarni";
      nahrat.textContent = "Nahrát fotky";
      nahrat.addEventListener("click", function () {
        otevriNahravaniFotek(sk.navsteva.id);
      });
      hlava.appendChild(nahrat);
    }
    oddil.appendChild(hlava);

    var souhrnSyroveho = vytvorSouhrnSyroveho(syrove, sk.klic);
    if (souhrnSyroveho) oddil.appendChild(souhrnSyroveho);

    galerijni.forEach(function (m) {
      var blok = vytvorGaleriiMaterialu(m);
      if (blok) oddil.appendChild(blok);
    });

    if (karty.length) {
      var mrizka = document.createElement("div");
      mrizka.className = "karty-mrizka";
      karty.forEach(function (m) {
        mrizka.appendChild(vytvorKartu(m));
      });
      oddil.appendChild(mrizka);
    }

    return oddil;
  }

  function vytvorPrazdnyStav(text) {
    var prazdno = document.createElement("div");
    prazdno.className = "prazdny-stav";
    var ikona = document.createElement("div");
    ikona.className = "prazdny-stav-ikona";
    var popis = document.createElement("p");
    popis.className = "prazdny-stav-text";
    popis.textContent = text;
    prazdno.appendChild(ikona);
    prazdno.appendChild(popis);
    return prazdno;
  }

  function vykresli(kontejnerParam) {
    var kontejner = kontejnerParam || document.getElementById("obsah");
    if (!kontejner) return;

    zrusPozorovatele();

    var vsechnyMaterialy = ziskejPolozky("materialy").filter(function (m) {
      return !m.smazano && m.prijemce !== "Emauzy";
    });
    var navstevy = ziskejPolozky("navstevy").filter(function (n) {
      return !n.smazano;
    });

    while (kontejner.firstChild) kontejner.removeChild(kontejner.firstChild);

    kontejner.appendChild(vytvorHlavicku(vsechnyMaterialy, navstevy));

    // Filtry jdou nad skupiny, protože obsah je teď rozdělený po návštěvách.
    // Týkají se ale pořád jen karet (ne galerií, ne pracovního materiálu) —
    // je to pod nimi napsané, ať to není hádanka.
    var filtryOddil = document.createElement("section");
    filtryOddil.className = "oddil";
    filtryOddil.appendChild(vytvorFiltry(kontejner));
    var poznamkaFiltru = document.createElement("p");
    poznamkaFiltru.className = "filtr-poznamka";
    poznamkaFiltru.textContent =
      "Filtr se týká seznamu materiálů — galerií náhledů ani pracovního materiálu se nedotýká.";
    filtryOddil.appendChild(poznamkaFiltru);
    kontejner.appendChild(filtryOddil);

    var skupiny = seskupitPodleNavstevy(vsechnyMaterialy, navstevy);
    var vykreslenych = 0;
    skupiny.forEach(function (sk) {
      var blok = vytvorSkupinu(sk);
      if (!blok) return;
      kontejner.appendChild(blok);
      vykreslenych++;
    });

    if (!vykreslenych) {
      var seznamOddil = document.createElement("section");
      seznamOddil.className = "oddil";
      seznamOddil.appendChild(
        vytvorPrazdnyStav(
          vsechnyMaterialy.length ? "Žádný materiál neodpovídá filtru." : "Zatím žádné materiály."
        )
      );
      kontejner.appendChild(seznamOddil);
    }
  }

  // ---------------------------------------------------------------------
  // Sdilena stavebnice karet pro sekci "Materiál pro Emauzy" (dodatek §B.2:
  // "Kód karet neduplikuj — vystav znovupoužitelnou funkci z view-materialy.js").
  // Vsechny funkce ctou App.polozky/Auth.can samy, takze se chovaji v obou
  // sekcich stejne vcetne prav.
  // ---------------------------------------------------------------------

  window.MaterialyUI = {
    TYPY: TYP_MATERIALU,
    STAVY: STAV_MATERIALU,
    karta: vytvorKartu,
    otevriFormular: otevriFormularMaterialu,
    komentare: vytvorKomentare,
    // galerie náhledů — sekce Emauzy ji vykresluje úplně stejně, jakmile
    // materiál pro klášter dostane pole `galerie` (resp. `nahledy`)
    maGalerii: maGalerii,
    galerie: vytvorGaleriiMaterialu,
    zrusGalerie: zrusPozorovatele
  };

  App.registrujSekci("materialy", vykresli);
})();
