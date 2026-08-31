/*
 * view-emauzy.js — sekce "Materiál pro Emauzy" (KONTRAKT_DODATEK.md §B) kokpitu
 * Pragerovy kostky.
 *
 * Proč vlastní sekce: Emauzský klášter nám má povolit časosběrnou kameru na svém
 * balkoně a protiplněním je foto a video z jejich objektu. Je to samostatný závazek
 * MIMO smlouvu s PORR, takže se nesmí míchat s dodávkami pro PORR — proto se sleduje
 * zvlášť, ať nezapadne.
 *
 * Sekce má tři části (§B.2):
 *   1. vysvětlující karta s doslovným textem z dodatku a pod ní odkaz
 *      „Místo pro kameru → Časosběr“ na #casosber,
 *   2. stav závazku — kolik položek je "hotovo"/"predano" z celku,
 *   3. seznam materiálů s `prijemce === "Emauzy"`; prázdný stav
 *      „Zatím nic. Materiál pro klášter se teprve připravuje.“
 *
 * Datový model je společný se sekcí Materiály — žádný nový soubor (§B.1). Rozdíl je
 * jen v poli `prijemce`: tady se zobrazují položky s `prijemce === "Emauzy"`, sekce
 * Materiály zobrazuje zbytek (chybějící hodnota = "PORR"). Nově přidaný materiál
 * v této sekci má proto ve formuláři PŘEDNASTAVENO `prijemce: "Emauzy"`; přepnutí
 * pole „Příjemce“ položku mezi oběma sekcemi přesune.
 *
 * Karty materiálu (MyAirBridge s hlídáním expirace, Vimeo embed až na klik, stav,
 * poznámka, komentáře) se NEDUPLIKUJÍ — používá se sdílená stavebnice `MaterialyUI`
 * vystavená z js/view-materialy.js (viz jeho hlavičkový komentář). Tím pádem tady
 * platí i úplně stejná práva (materialy.pridat / materialy.upravit / materialy.smazat
 * a komentare.pridat), protože je kontroluje ta samá funkce.
 *
 * Totéž platí pro GALERII NÁHLEDŮ: materiál, který má pole `galerie`
 * [{nahled, velky, popisek, zarizeni}] — nebo `nahledy` [{cesta, popisek}], což je
 * tvar, který zapisuje scripts/emauzy_nahledy.py — se vykreslí jako mřížka náhledů
 * přes MaterialyUI.galerie(), stejně jako v sekci Materiály. Dokud fotky pro klášter
 * nejsou nahrané, žádný materiál galerii nemá a sekce vypadá přesně jako dosud;
 * jakmile je skript doplní, galerie se objeví sama a nic se tu nemusí měnit.
 *
 * Čte App.polozky("materialy"), zápis obstarává MaterialyUI (GH.zmen + App.uloz).
 * Označení lidí u komentářů (pole `zminky`) tu funguje samo — komentáře staví
 * ta samá MaterialyUI, takže tahle sekce o nich nic vlastního neví.
 *
 * Nevystavuje žádný globální objekt — jen se při načtení zaregistruje jako sekce
 * 'emauzy' přes App.registrujSekci('emauzy', vykresli).
 */

(function () {
  "use strict";

  var SOUBOR = "materialy";
  var PRIJEMCE = "Emauzy";

  // Doslovny text vysvetlujici karty z KONTRAKT_DODATEK.md §B.2 — nemenit,
  // je to formulace, na ktere se s Frantou domluvilo zadani.
  var NADPIS_VYSVETLENI = "Protiplnění za kameru na balkoně";
  var TEXT_VYSVETLENI =
    "Emauzský klášter nám umožňuje umístit časosběrnou kameru na svém balkoně. " +
    "Na oplátku pro klášter připravujeme fotografie a video z jejich objektu. " +
    "Je to samostatný závazek mimo smlouvu s PORR — sledujeme ho zde, ať nezapadne.";

  // stavy, ktere se pocitaji jako splneny zavazek vuci klasteru (§B.2 bod 3)
  var STAVY_SPLNENO = ["hotovo", "predano"];

  // ---------------------------------------------------------------------
  // Data — App.data[soubor] drzi VZDY celou obalku {verze,...,polozky},
  // takze se cte vyhradne pres App.polozky() (viz js/app.js).
  // ---------------------------------------------------------------------

  function materialyProEmauzy() {
    return App.polozky(SOUBOR).filter(function (m) {
      return m && !m.smazano && m.prijemce === PRIJEMCE;
    });
  }

  function jeSplneno(m) {
    return STAVY_SPLNENO.indexOf(m.stav) !== -1;
  }

  // ---------------------------------------------------------------------
  // Casti sekce
  // ---------------------------------------------------------------------

  function vytvorUvod() {
    var oddil = document.createElement("section");
    oddil.className = "oddil";

    var h2 = document.createElement("h2");
    h2.className = "nadpis-sekce";
    h2.textContent = "Materiál pro Emauzy";
    oddil.appendChild(h2);

    var karta = document.createElement("div");
    karta.className = "karta";
    // zeleny akcentovy prouzek vlevo pres stejny mechanismus jako .stav-* tridy
    karta.style.setProperty("--stav-barva", "var(--akcent)");

    var nadpis = document.createElement("h3");
    nadpis.className = "karta-nadpis";
    nadpis.textContent = NADPIS_VYSVETLENI;
    karta.appendChild(nadpis);

    var text = document.createElement("p");
    text.className = "karta-popis";
    text.textContent = TEXT_VYSVETLENI;
    karta.appendChild(text);

    var odkazRadek = document.createElement("div");
    odkazRadek.className = "karta-akce";
    var odkaz = document.createElement("a");
    odkaz.href = "#casosber";
    odkaz.className = "btn btn-mala btn-sekundarni";
    odkaz.textContent = "Místo pro kameru → Časosběr";
    odkazRadek.appendChild(odkaz);
    karta.appendChild(odkazRadek);

    oddil.appendChild(karta);
    return oddil;
  }

  function vytvorStavZavazku(polozky) {
    var celkem = polozky.length;
    var splneno = polozky.filter(jeSplneno).length;

    var oddil = document.createElement("section");
    oddil.className = "oddil";

    var nadpis = document.createElement("h3");
    nadpis.className = "skupina-nadpis";
    nadpis.textContent = "Stav závazku";
    oddil.appendChild(nadpis);

    var radek = document.createElement("div");
    radek.className = "progress-radek";

    var popisek = document.createElement("div");
    popisek.className = "progress-popisek";
    var vlevo = document.createElement("span");
    vlevo.textContent = "Hotovo nebo předáno klášteru";
    var vpravo = document.createElement("span");
    vpravo.textContent = splneno + " z " + celkem;
    popisek.appendChild(vlevo);
    popisek.appendChild(vpravo);
    radek.appendChild(popisek);

    var pruh = document.createElement("div");
    pruh.className = "progress";
    var vypln = document.createElement("div");
    vypln.className = "progress-vyplneno";
    if (splneno === celkem) vypln.classList.add("progress-plno");
    vypln.style.width = Math.round((splneno / celkem) * 100) + "%";
    pruh.appendChild(vypln);
    radek.appendChild(pruh);

    oddil.appendChild(radek);

    var shrnuti = document.createElement("p");
    shrnuti.className = "podnadpis-sekce";
    shrnuti.style.marginTop = "10px";
    if (splneno === 0) {
      shrnuti.textContent =
        "Klášteru zatím nebylo předáno nic — protiplnění za kameru na balkoně je stále otevřené.";
    } else if (splneno === celkem) {
      shrnuti.textContent = "Všechno je hotové — závazek vůči klášteru je splněný.";
    } else {
      shrnuti.textContent = "Zbývá dokončit " + (celkem - splneno) + " z " + celkem + " položek.";
    }
    oddil.appendChild(shrnuti);

    return oddil;
  }

  function vytvorPrazdnyStav() {
    var prazdno = document.createElement("div");
    prazdno.className = "prazdny-stav";
    var ikona = document.createElement("div");
    ikona.className = "prazdny-stav-ikona";
    var text = document.createElement("p");
    text.className = "prazdny-stav-text";
    text.textContent = "Zatím nic. Materiál pro klášter se teprve připravuje.";
    prazdno.appendChild(ikona);
    prazdno.appendChild(text);
    return prazdno;
  }

  // Materiál s náhledy (pole `galerie`, resp. `nahledy` od
  // scripts/emauzy_nahledy.py) se vykreslí jako galerie, ne jako karta —
  // úplně stejná stavebnice jako v sekci Materiály. Dokud fotky pro klášter
  // nejsou, tahle funkce vrátí false a všechno se chová jako dosud.
  function maGalerii(m) {
    return !!(window.MaterialyUI && typeof MaterialyUI.maGalerii === "function" && MaterialyUI.maGalerii(m));
  }

  function vytvorSeznam(polozky) {
    var oddil = document.createElement("section");
    oddil.className = "oddil";

    var nadpis = document.createElement("h3");
    nadpis.className = "skupina-nadpis";
    nadpis.textContent = "Materiály pro klášter";
    oddil.appendChild(nadpis);

    if (window.MaterialyUI && Auth.can("materialy.pridat")) {
      var pridat = document.createElement("button");
      pridat.type = "button";
      pridat.className = "btn btn-primarni";
      pridat.style.marginBottom = "14px";
      pridat.textContent = "+ Přidat materiál pro Emauzy";
      pridat.addEventListener("click", function () {
        // druhy argument = PREDNASTAVENY prijemce noveho materialu (§B.2)
        MaterialyUI.otevriFormular(null, PRIJEMCE);
      });
      oddil.appendChild(pridat);
    }

    if (!polozky.length) {
      oddil.appendChild(vytvorPrazdnyStav());
      return oddil;
    }

    if (!window.MaterialyUI) {
      // js/view-materialy.js se nenacetl (spatne poradi <script> v index.html)
      // — radeji vypis srozumitelnou hlasku nez prazdnou sekci.
      var chyba = document.createElement("p");
      chyba.className = "prazdny-stav-text";
      chyba.textContent = "Karty materiálů se nenačetly — chybí js/view-materialy.js.";
      oddil.appendChild(chyba);
      return oddil;
    }

    // Nejdřív galerie (to je to, co má klášter reálně vidět), pod nimi karty.
    polozky.forEach(function (m) {
      if (!maGalerii(m)) return;
      var blok = MaterialyUI.galerie(m);
      if (blok) oddil.appendChild(blok);
    });

    var bezGalerie = polozky.filter(function (m) {
      return !maGalerii(m);
    });
    if (bezGalerie.length) {
      var mrizka = document.createElement("div");
      mrizka.className = "karty-mrizka";
      bezGalerie.forEach(function (m) {
        mrizka.appendChild(MaterialyUI.karta(m));
      });
      oddil.appendChild(mrizka);
    }

    return oddil;
  }

  // ---------------------------------------------------------------------
  // Vykresleni sekce
  // ---------------------------------------------------------------------

  function vykresli(kontejnerParam) {
    var kontejner = kontejnerParam || document.getElementById("obsah");
    if (!kontejner) return;

    // pozorovatelé náhledů z předchozího vykreslení (i z druhé sekce) pryč
    if (window.MaterialyUI && typeof MaterialyUI.zrusGalerie === "function") {
      MaterialyUI.zrusGalerie();
    }

    while (kontejner.firstChild) kontejner.removeChild(kontejner.firstChild);

    var polozky = materialyProEmauzy();

    kontejner.appendChild(vytvorUvod());
    // pri nula polozkach by byl ukazatel "0 z 0" jen matouci — stav zavazku
    // se ukaze az kdyz je co pocitat, jinak mluvi prazdny stav v seznamu
    if (polozky.length) kontejner.appendChild(vytvorStavZavazku(polozky));
    kontejner.appendChild(vytvorSeznam(polozky));
  }

  App.registrujSekci("emauzy", vykresli);
})();
