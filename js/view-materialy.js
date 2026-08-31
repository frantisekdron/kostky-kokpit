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
 *      a komentáři. Nad nimi filtry podle typu a stavu, seskupení podle návštěvy
 *      (materiály bez návštěvy do skupiny "Bez návštěvy").
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
    blok.appendChild(mrizka);

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
  // nepředává. Nedávají se proto jako plné karty, ale do jednoho tichého
  // panelu nahoře. Počty a velikosti udržuje scripts/inventura.py projetím
  // složky s natáčením — v UI se jen zobrazují, nikdy nepřepisují.
  // ---------------------------------------------------------------------

  var syroveOtevreno = false;

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

  function vytvorSouhrnSyroveho(syrove) {
    if (!syrove.length) return null;

    var oddil = document.createElement("section");
    oddil.className = "oddil";

    // .harmonogram-panel / -summary / -telo je v styles.css tichý rozklikávací
    // panel (summary má min-height 44 px kvůli dotyku). Levá linka je tam modrá
    // „citace od PORR" — tady je to náš vlastní text, tak se ztlumí na --linka.
    var panel = document.createElement("details");
    panel.className = "harmonogram-panel";
    panel.style.borderLeftColor = "var(--linka)";
    panel.open = syroveOtevreno;
    panel.addEventListener("toggle", function () {
      syroveOtevreno = panel.open;
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
  // Filtry a seskupeni
  // ---------------------------------------------------------------------

  function projdeFiltrem(m) {
    if (filtrTyp !== "vse" && m.typ !== filtrTyp) return false;
    if (filtrStav !== "vse" && m.stav !== filtrStav) return false;
    return true;
  }

  function seskupitPodleNavstevy(materialy, navstevy) {
    var skupiny = {};
    materialy.forEach(function (m) {
      var klic = m.navsteva_id || "__bez__";
      if (!skupiny[klic]) skupiny[klic] = [];
      skupiny[klic].push(m);
    });

    var vysledek = [];
    var pouzite = {};
    var razeneNavstevy = navstevy.slice().sort(function (a, b) {
      return (a.cislo || 0) - (b.cislo || 0);
    });
    razeneNavstevy.forEach(function (n) {
      if (skupiny[n.id]) {
        vysledek.push({ nazev: "Natáčení č. " + n.cislo + " — " + n.nazev, polozky: skupiny[n.id] });
        pouzite[n.id] = true;
      }
    });
    // materialy odkazujici na navstevu, ktera uz neni v aktualnim (nesmazanem)
    // seznamu navstev - at se neztrati, dej je do vlastni skupiny podle ID
    Object.keys(skupiny).forEach(function (klic) {
      if (klic === "__bez__" || pouzite[klic]) return;
      vysledek.push({ nazev: "Návštěva (" + klic + ")", polozky: skupiny[klic] });
    });
    if (skupiny["__bez__"]) {
      vysledek.push({ nazev: "Bez návštěvy", polozky: skupiny["__bez__"] });
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

  function vytvorHlavicku(materialy) {
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

    if (Auth.can("materialy.pridat")) {
      var pridat = document.createElement("button");
      pridat.type = "button";
      pridat.className = "btn btn-primarni";
      pridat.style.marginTop = "10px";
      pridat.textContent = "+ Přidat materiál";
      pridat.addEventListener("click", function () {
        otevriFormularMaterialu(null, "PORR");
      });
      oddil.appendChild(pridat);
    }

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

    // Tři různé druhy obsahu, každý se zobrazuje jinak:
    //   syrové     — pracovní materiál ke střihu, jen tiché shrnutí nahoře
    //   galerijní  — materiál s náhledy, hlavní obsah sekce (mřížka)
    //   ostatní    — videa a zbytek, běžné karty pod galerií
    var syrove = vsechnyMaterialy.filter(function (m) {
      return m.syrovy === true;
    });
    var galerijni = vsechnyMaterialy.filter(function (m) {
      return m.syrovy !== true && maGalerii(m);
    });
    var ostatni = vsechnyMaterialy.filter(function (m) {
      return m.syrovy !== true && !maGalerii(m);
    });

    while (kontejner.firstChild) kontejner.removeChild(kontejner.firstChild);

    kontejner.appendChild(vytvorHlavicku(vsechnyMaterialy));

    var souhrnSyroveho = vytvorSouhrnSyroveho(syrove);
    if (souhrnSyroveho) kontejner.appendChild(souhrnSyroveho);

    galerijni.forEach(function (m) {
      var blok = vytvorGaleriiMaterialu(m);
      if (blok) kontejner.appendChild(blok);
    });

    var filtryOddil = document.createElement("section");
    filtryOddil.className = "oddil";
    filtryOddil.appendChild(vytvorFiltry(kontejner));
    kontejner.appendChild(filtryOddil);

    var filtrovane = ostatni.filter(projdeFiltrem);
    var skupiny = seskupitPodleNavstevy(filtrovane, navstevy);

    var seznamOddil = document.createElement("section");
    seznamOddil.className = "oddil";

    if (!filtrovane.length) {
      var prazdno = document.createElement("div");
      prazdno.className = "prazdny-stav";
      var ikona = document.createElement("div");
      ikona.className = "prazdny-stav-ikona";
      var text = document.createElement("p");
      text.className = "prazdny-stav-text";
      if (!ostatni.length) {
        text.textContent = vsechnyMaterialy.length
          ? "Další materiály tu zatím nejsou — galerie a pracovní materiál jsou nahoře."
          : "Zatím žádné materiály.";
      } else {
        text.textContent = "Žádný materiál neodpovídá filtru.";
      }
      prazdno.appendChild(ikona);
      prazdno.appendChild(text);
      seznamOddil.appendChild(prazdno);
    } else {
      skupiny.forEach(function (sk) {
        var nadpis = document.createElement("h3");
        nadpis.className = "osa-rok";
        nadpis.textContent = sk.nazev;
        seznamOddil.appendChild(nadpis);

        var mrizka = document.createElement("div");
        mrizka.className = "karty-mrizka";
        sk.polozky.forEach(function (m) {
          mrizka.appendChild(vytvorKartu(m));
        });
        seznamOddil.appendChild(mrizka);
      });
    }
    kontejner.appendChild(seznamOddil);
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
