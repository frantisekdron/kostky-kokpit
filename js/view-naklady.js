/* js/view-naklady.js — sekce „Náklady na provoz" (jen super admin).
 *
 * Kolik nás projekt doopravdy stojí a co ze smluvní ceny zbývá. Tohle je
 * jediná sekce v celém kokpitu, kterou nemá vidět nikdo kromě Honzy.
 *
 * POZOR: tenhle soubor jde do VEŘEJNÉHO repa appky. Žádné konkrétní částky,
 * ceny ani marže sem nepatří — ani do komentáře. Čísla se čtou z dat.
 *
 * PROČ JE OBSAH ZAŠIFROVANÝ (tohle je jádro celé sekce, nemazat):
 * Role v appce (superadmin/admin/editor/ctenar) jsou ORGANIZAČNÍ, ne
 * kryptografické. Zapisovací token do privátního repa kostky-data má všech
 * sedm lidí — včetně investora (PORR) a zhotovitele (Metrostav). Kdokoli
 * z nich si obsah repa může přečíst přímo přes GitHub, i když mu appka odkaz
 * v navigaci neukáže. Kdybychom sekci jen schovali v UI, byl by to klam:
 * náklady a marže jsou přesně to, co před nimi má zůstat skryté.
 * Proto je obsah data/naklady.json ZAŠIFROVANÝ (AES-GCM, klíč z hesla přes
 * PBKDF2 — js/crypto.js) a na disku leží jen šifra:
 *
 *   { verze, zmeneno, zmenil, sifrovano: { salt, iv, ct } }
 *
 * Po rozšifrování je uvnitř { polozky: [ … ] }, položka:
 *   { id: "nak-…", datum: "2026-08-26", kategorie: "doprava",
 *     popis, castka (Kč BEZ DPH, celé číslo), mnozstvi, jednotka,
 *     navazano_na: "nav-01"|null, poznamka, kdo: "os-06", kdy, smazano }
 *
 * HESLO:
 *   - je VLASTNÍ, jiné než přihlašovací. Přihlašovací hesla jsou schválně
 *     slabá (Frantovo rozhodnutí) a jejich zašifrované bloby leží ve VEŘEJNÉM
 *     config.js — daly by se rozlousknout hrubou silou. Tohle heslo není
 *     nikde: ani v config.js, ani v localStorage, ani v datech.
 *   - drží se jen v PAMĚTI po dobu běhu stránky. Po přenačtení se zadá znovu.
 *   - když soubor ještě neexistuje, zadává se DVAKRÁT a s varováním: zapomenuté
 *     heslo znamená nenávratně ztracená data. Není odkud je obnovit.
 *
 * CO SE NEDĚLÁ:
 *   - Rozšifrovaná data NIKDY neleží v App.data — žijí jen v proměnné
 *     `otevrene` v tomhle souboru. App.polozky("naklady") proto vrací prázdno
 *     a je to tak správně.
 *   - Zápis NEZAKLÁDÁ záznam do aktivita.json (GH.zmen se volá s popisem
 *     `null`). Aktivitu čte celý tým a nemá důvod vědět, kdy se hýbalo
 *     s náklady. Co skrýt nejde, je commit message v repu („kokpit:
 *     aktualizace naklady") — ta ale neprozradí ani jedno číslo.
 *   - Smazané položky se vracejí PŘÍMO tady, ne ve sdíleném Koši. Koš čte
 *     otevřené soubory a náklady do něj nepatří.
 *
 * SOUBĚH: mutátor dostává celou obálku (gh.js, ROZSIRENA_OBALKA) a před
 * zápisem porovná `ct` na serveru s tím, ze kterého jsme rozšifrovali. Když
 * se liší, zápis se odmítne srozumitelnou hláškou — přepsat cizí změnu
 * naslepo nejde, protože zašifrovaná data se nedají spojit po položkách.
 *
 * Nevystavuje žádný globální objekt — registruje se jako sekce "naklady".
 */

(function () {
  "use strict";

  var SOUBOR = "naklady";

  // Pevný číselník kategorií. Kód se ukládá do dat přesně takhle (včetně
  // diakritiky) — je to zároveň to, co je v kontraktu, takže se ručně
  // upravený JSON pozná bez převodní tabulky.
  var KATEGORIE = [
    { kod: "doprava", nazev: "Doprava" },
    { kod: "technika", nazev: "Technika" },
    { kod: "práce", nazev: "Práce" },
    { kod: "subdodávka", nazev: "Subdodávka" },
    { kod: "kamery", nazev: "Kamery" },
    { kod: "instalace", nazev: "Instalace" },
    { kod: "servis", nazev: "Servis" },
    { kod: "software", nazev: "Software" },
    { kod: "ostatní", nazev: "Ostatní" }
  ];

  // ---- stav sekce, výhradně v paměti ----

  var heslo = null;          // heslo k nákladům — NIKDY se nikam neukládá
  var otevrene = null;       // { polozky: [...] } po rozšifrování
  var zakladCt = null;       // ct, ze kterého je `otevrene` rozšifrované
  var desifrovaniBezi = false;

  var filtrKategorie = "vse";
  var filtrRok = "vse";
  var ukazSmazane = false;

  // ---- drobné pomůcky ----

  // gh.js by holou Error obalil do „Neočekávaná chyba: …". S nastavenou
  // vlastností `hlaska` projde text beze změny až do toastu.
  function chybaProUzivatele(text) {
    var chyba = new Error(text);
    chyba.hlaska = text;
    return chyba;
  }

  function jeSuperadmin() {
    return !!(window.Auth && Auth.role === "superadmin");
  }

  function mojeOsobaId() {
    return (window.Auth && Auth.ja && Auth.ja.osoba_id) || null;
  }

  function obalka() {
    var o = App.data && App.data[SOUBOR];
    return o && typeof o === "object" ? o : {};
  }

  function sifra() {
    var s = obalka().sifrovano;
    return s && s.ct ? s : null;
  }

  // Celé číslo s mezerami po tisících. Vlastní, ne toLocaleString — ať to
  // vypadá stejně ve všech prohlížečích a nedá se to rozbít nastavením systému.
  function cislo(hodnota) {
    var zaokrouhlene = Math.round(Number(hodnota) || 0);
    var zaporne = zaokrouhlene < 0;
    var zbytek = String(Math.abs(zaokrouhlene));
    var vystup = "";
    while (zbytek.length > 3) {
      vystup = "\u00a0" + zbytek.slice(-3) + vystup; // nezlomitelna mezera
      zbytek = zbytek.slice(0, -3);
    }
    return (zaporne ? "−" : "") + zbytek + vystup;
  }

  function kc(hodnota) {
    return cislo(hodnota) + " Kč";
  }

  function procenta(cast, celek) {
    if (!celek) return "—";
    return (Math.round((cast / celek) * 1000) / 10).toString().replace(".", ",") + " %";
  }

  function nazevKategorie(kod) {
    for (var i = 0; i < KATEGORIE.length; i++) {
      if (KATEGORIE[i].kod === kod) return KATEGORIE[i].nazev;
    }
    return kod ? String(kod) : "Bez kategorie";
  }

  // Po migraci žije smlouva v šifře. Do té doby se bere z otevřených dat,
  // ať sekce mezitím funguje — a právě rozdíl mezi těmi dvěma místy říká,
  // jestli je migrace ještě před námi.
  function smlouva() {
    if (otevrene && otevrene.smlouva) return otevrene.smlouva;
    var n = App.obsah("nastaveni");
    return (n && n.smlouva) || {};
  }

  // Interní čísla ještě leží v otevřených datech?
  function jeCoMigrovat() {
    var n = App.obsah("nastaveni") || {};
    var maVOtevrenych = !!(n.smlouva || n.interni_upozorneni);
    var maVSifre = !!(otevrene && (otevrene.smlouva || otevrene.interni));
    return maVOtevrenych && !maVSifre;
  }

  function cenaBezDph() {
    var hodnota = Number(smlouva().cena_bez_dph);
    return isFinite(hodnota) ? hodnota : 0;
  }

  // ---- práce nad rozšifrovanými položkami ----

  function vsechnyPolozky() {
    return (otevrene && Array.isArray(otevrene.polozky)) ? otevrene.polozky : [];
  }

  function zive() {
    return vsechnyPolozky().filter(function (p) { return p && p.id && !p.smazano; });
  }

  function smazane() {
    return vsechnyPolozky().filter(function (p) { return p && p.id && p.smazano; });
  }

  function soucet(pole) {
    return pole.reduce(function (celkem, p) {
      var c = Number(p && p.castka);
      return celkem + (isFinite(c) ? c : 0);
    }, 0);
  }

  function rok(p) {
    return String((p && p.datum) || "").slice(0, 4);
  }

  function nazevNavstevy(id) {
    if (!id) return "";
    var seznam = App.polozky("navstevy");
    for (var i = 0; i < seznam.length; i++) {
      if (seznam[i] && seznam[i].id === id) {
        var n = seznam[i];
        return (n.cislo ? "č. " + n.cislo + " — " : "") + (n.nazev || "(bez názvu)");
      }
    }
    return "(návštěva už neexistuje)";
  }

  // ---- zápis: zašifrovat celý seznam a vyměnit blob v obálce ----
  //
  // Šifrování je asynchronní, mutátor GH.zmen synchronní — nová šifra se proto
  // spočítá PŘED zápisem a v mutátoru se jen vymění. Aby to nepřepsalo cizí
  // změnu, mutátor napřed porovná `ct` na serveru s tím, ze kterého jsme četli.
  // Šifrovaný obsah nese vedle položek i obchodně citlivé údaje přesunuté
  // z otevřených dat (smluvní cena, interní upozornění). Musí se protáhnout
  // KAŽDÝM zápisem, jinak by je první uložená položka zahodila.
  function obsahKZasifrovani(novePolozky, prepis) {
    var puvodni = otevrene || {};
    var vysledek = { polozky: novePolozky };
    var smlouvaNova = prepis && prepis.smlouva ? prepis.smlouva : puvodni.smlouva;
    var interniNove = prepis && prepis.interni ? prepis.interni : puvodni.interni;
    if (smlouvaNova) vysledek.smlouva = smlouvaNova;
    if (interniNove) vysledek.interni = interniNove;
    return vysledek;
  }

  function zapis(novePolozky, prepis) {
    if (!heslo) {
      return Promise.reject(chybaProUzivatele("Náklady jsou zamčené. Odemkni je heslem."));
    }
    var puvodniCt = zakladCt;
    var novyBlob = null;
    var kZasifrovani = obsahKZasifrovani(novePolozky, prepis);
    return Krypto.zasifruj(kZasifrovani, heslo)
      .then(function (blob) {
        novyBlob = blob;
        return GH.zmen(SOUBOR, function (obal) {
          if (!obal || typeof obal !== "object") {
            throw chybaProUzivatele("Soubor s náklady se nepodařilo přečíst — nic se neuložilo.");
          }
          var naServeru = obal.sifrovano && obal.sifrovano.ct ? obal.sifrovano.ct : null;
          if (naServeru !== puvodniCt) {
            throw chybaProUzivatele("Náklady mezitím změnil někdo jiný (nebo jiná záložka). " +
              "Zašifrovaná data nejde slučovat po položkách, takže se nic neuložilo. " +
              "Načti stránku znovu a zapiš to ještě jednou.");
          }
          obal.sifrovano = novyBlob;
          // Pojistka: obálka nákladů žádné otevřené „polozky" nést nesmí.
          if ("polozky" in obal) delete obal.polozky;
        }, null); // popis = null schválně: žádný záznam do sdílené aktivity
      })
      .then(function (obsah) {
        App.uloz(SOUBOR, obsah);
        otevrene = kZasifrovani;
        zakladCt = novyBlob.ct;
        return true;
      });
  }

  // ---- jednorázový přesun interních čísel z otevřených dat do šifry ----
  //
  // POŘADÍ JE ZÁVAZNÉ: napřed zapsat do šifry, uklidit z nastaveni.json TEPRVE
  // po úspěchu. Kdyby to bylo naopak a druhý krok selhal, čísla by byla
  // nenávratně pryč. Takhle v nejhorším zůstanou chvíli na dvou místech —
  // nepříjemné, ale nic se neztratí, a druhé spuštění to dorovná.
  function presunDoSifry() {
    var n = App.obsah("nastaveni") || {};
    var smlouvaZOtevrenych = n.smlouva && typeof n.smlouva === "object" ? n.smlouva : null;
    var interniZOtevrenych = n.interni_upozorneni && typeof n.interni_upozorneni === "object"
      ? n.interni_upozorneni : null;

    if (!smlouvaZOtevrenych && !interniZOtevrenych) {
      App.toast("V otevřených datech už žádná interní čísla nejsou.", "info");
      App.prekresli();
      return Promise.resolve(false);
    }

    // krok 1 — do šifry
    return zapis(vsechnyPolozky(), {
      smlouva: smlouvaZOtevrenych || undefined,
      interni: interniZOtevrenych || undefined
    })
      .then(function () {
        // krok 2 — až teď uklidit z otevřených dat
        return GH.zmen("nastaveni", function (data) {
          if (!data || typeof data !== "object") {
            throw chybaProUzivatele("Nastavení se nepodařilo přečíst.");
          }
          delete data.smlouva;
          delete data.interni_upozorneni;
        }, "Interní obchodní údaje přesunuty do šifrovaného úložiště")
          .then(function (obsah) {
            App.uloz("nastaveni", obsah);
            App.toast("Přesunuto. Interní čísla už v otevřených datech nejsou.", "ok");
            App.prekresli();
            return true;
          })
          .catch(function (chyba) {
            // Šifra už je zapsaná, takže nic není ztracené — jen se to nestihlo
            // uklidit. Musí to být řečeno naplno, ne schované za obecnou chybu.
            console.warn("Úklid otevřených dat po přesunu selhal:", chyba);
            App.toast("Do šifry se to zapsalo, ale úklid otevřených dat se nepovedl. "
              + "Nic se neztratilo — čísla jsou teď na dvou místech. "
              + "Zkus přesun ještě jednou.", "chyba");
            App.prekresli();
            return false;
          });
      })
      .catch(function (chyba) {
        ohlasChybu(chyba);
        return false;
      });
  }

  // Přístup pro Přehled: interní obchodní údaje, nebo null když je zamčeno.
  // Registruje se za běhu — view-*.js se načítají PŘED js/app.js, takže
  // přiřazení při načtení souboru by nikdo neviděl.
  function zpristupniPrehledu() {
    App.interniObchodni = function () {
      if (!jeSuperadmin() || !otevrene) return null;
      var n = App.obsah("nastaveni") || {};
      return {
        smlouva: otevrene.smlouva || n.smlouva || null,
        interni: otevrene.interni || n.interni_upozorneni || null
      };
    };
    // Ať Přehled pozná rozdíl mezi „zamčeno" a „nemáš na to právo".
    App.interniZamceno = function () {
      return jeSuperadmin() && !otevrene;
    };
  }

  // Vrátí novou kopii seznamu se změněnou položkou daného id, nebo null,
  // když položka zmizela. VŽDY podle id, nikdy podle indexu.
  function sePolozkou(id, uprav) {
    var nalezeno = false;
    var nove = vsechnyPolozky().map(function (p) {
      if (!p || p.id !== id) return p;
      nalezeno = true;
      var kopie = JSON.parse(JSON.stringify(p));
      uprav(kopie);
      return kopie;
    });
    return nalezeno ? nove : null;
  }

  function ohlasChybu(chyba) {
    App.toast((chyba && (chyba.hlaska || chyba.message)) || "Uložení se nepovedlo.", "chyba");
  }

  // ---- odemykání / zakládání ----

  function zkusOdemknout(zadane) {
    var blob = sifra();
    if (!blob) return Promise.resolve(false);
    return Krypto.desifruj(blob, zadane).then(function (data) {
      if (!data || typeof data !== "object") return false;
      // Pozor na tichou ztrátu dat: kdyby `polozky` nebylo pole (ruční editace,
      // cizí skript), dřív se to spolklo jako prázdno — sekce vypadala prázdně
      // a první zápis původní obsah přepsal. Radši odemknutí odmítneme.
      if (data.polozky !== undefined && data.polozky !== null
          && !Array.isArray(data.polozky)) {
        App.toast("Data nákladů mají neznámý tvar — radši do nich nezapisuji. "
          + "Ozvi se, ať se na to podívám.", "chyba");
        return false;
      }
      heslo = zadane;
      otevrene = { polozky: Array.isArray(data.polozky) ? data.polozky : [] };
      if (data.smlouva && typeof data.smlouva === "object") otevrene.smlouva = data.smlouva;
      if (data.interni && typeof data.interni === "object") otevrene.interni = data.interni;
      zakladCt = blob.ct;
      return true;
    });
  }

  // Vyhodí heslo i rozšifrovaný obsah z paměti, ale nepřekresluje.
  function zapomenHeslo() {
    heslo = null;
    otevrene = null;
    zakladCt = null;
  }

  function zamkni() {
    zapomenHeslo();
    App.prekresli();
  }

  // POZOR na dvě pasti najednou:
  // 1) Hlídat roli jen uvnitř vykresli() NESTAČÍ. Když role klesne, router
  //    odveze člověka na Přehled a tahle sekce se už nevykreslí — heslo by
  //    zůstalo v paměti a po návratu role by byla rovnou odemčená.
  // 2) Registrovat posluchače při načtení souboru taky nejde: view-*.js se
  //    načítají PŘED js/app.js, takže App.naZmenuRole ještě neexistuje
  //    a registrace by tiše propadla (naletěl jsem na to).
  // Řešení: zaregistrovat se až při prvním vykreslení sekce. Do té doby
  //    stejně žádné heslo v paměti není, takže není co chránit.
  var posluchacRegistrovan = false;

  function zaregistrujHlidaniRole() {
    if (posluchacRegistrovan || typeof App.naZmenuRole !== "function") return;
    posluchacRegistrovan = true;
    App.naZmenuRole(function (role) {
      if (role !== "superadmin") zapomenHeslo();
    });
  }

  // ---- vykreslení: zámek ----

  function vykresliZamek(kontejner) {
    var karta = App.el("div", "naklady-zamek");
    karta.appendChild(App.el("h3", "naklady-zamek-nadpis", "Náklady jsou zamčené"));
    karta.appendChild(App.el("p", "naklady-zamek-text",
      "Obsah je zašifrovaný a heslo k němu je jiné než přihlašovací. Nikde se " +
      "neukládá, takže se po každém načtení stránky zadává znovu."));

    var form = document.createElement("form");
    form.className = "formular";

    var obal = App.el("div", "pole");
    var popisek = App.el("label", null, "Heslo k nákladům");
    popisek.setAttribute("for", "naklady-heslo");
    var vstup = document.createElement("input");
    vstup.type = "password";
    vstup.id = "naklady-heslo";
    vstup.className = "vstup";
    vstup.autocomplete = "off";
    obal.appendChild(popisek);
    obal.appendChild(vstup);
    form.appendChild(obal);

    var tlacitko = App.el("button", "btn btn-primarni", "Odemknout");
    tlacitko.type = "submit";
    form.appendChild(tlacitko);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var zadane = vstup.value;
      if (!zadane) {
        App.toast("Zadej heslo.", "chyba");
        return;
      }
      tlacitko.disabled = true;
      tlacitko.textContent = "Odemykám…";
      zkusOdemknout(zadane)
        .then(function (ok) {
          if (ok) {
            App.prekresli();
            return;
          }
          tlacitko.disabled = false;
          tlacitko.textContent = "Odemknout";
          vstup.value = "";
          vstup.focus();
          App.toast("Heslo nesedí. Zkus to znovu.", "chyba");
        })
        .catch(function () {
          tlacitko.disabled = false;
          tlacitko.textContent = "Odemknout";
          App.toast("Rozšifrování se nepovedlo.", "chyba");
        });
    });

    karta.appendChild(form);
    kontejner.appendChild(karta);
    window.setTimeout(function () { vstup.focus(); }, 0);
  }

  // ---- vykreslení: založení souboru ----

  function otevriZalozeni() {
    var form = document.createElement("form");
    form.className = "formular";
    form.addEventListener("submit", function (e) { e.preventDefault(); });

    var varovani = App.el("div", "naklady-varovani");
    varovani.appendChild(App.el("strong", null, "Tohle heslo nejde obnovit."));
    varovani.appendChild(App.el("p", "karta-meta",
      "Neukládá se nikam — ani do appky, ani do dat, ani do prohlížeče. " +
      "Když ho zapomeneš, jsou náklady nenávratně pryč a není odkud je vzít. " +
      "Zapiš si ho někam mimo kokpit."));
    form.appendChild(varovani);

    function polePro(popisekText, idPole) {
      var obal = App.el("div", "pole");
      var popisek = App.el("label", null, popisekText);
      popisek.setAttribute("for", idPole);
      var vstup = document.createElement("input");
      vstup.type = "password";
      vstup.id = idPole;
      vstup.className = "vstup";
      vstup.autocomplete = "new-password";
      obal.appendChild(popisek);
      obal.appendChild(vstup);
      form.appendChild(obal);
      return vstup;
    }

    var prvni = polePro("Heslo k nákladům", "naklady-nove-1");
    var druhe = polePro("Heslo znovu pro kontrolu", "naklady-nove-2");

    form.appendChild(App.el("p", "napoveda",
      "Použij něco jiného než přihlašovací heslo — ta jsou schválně krátká a " +
      "jejich zašifrovaná podoba je ve veřejném repu."));

    var probiha = false;
    var modal = App.modal({
      nadpis: "Založit náklady",
      obsah: form,
      akce: [
        { text: "Zrušit", druh: "sekundarni", fn: function () { modal.zavri(); } },
        {
          text: "Založit",
          druh: "primarni",
          fn: function () {
            if (probiha) return;
            if (prvni.value.length < 8) {
              App.toast("Heslo musí mít aspoň 8 znaků.", "chyba");
              return;
            }
            if (prvni.value !== druhe.value) {
              App.toast("Hesla se neshodují.", "chyba");
              return;
            }
            probiha = true;
            var zvolene = prvni.value;
            var novyBlob = null;
            Krypto.zasifruj({ polozky: [] }, zvolene)
              .then(function (blob) {
                novyBlob = blob;
                return GH.zmen(SOUBOR, function (obal) {
                  if (obal && obal.sifrovano && obal.sifrovano.ct) {
                    throw chybaProUzivatele("Náklady už mezitím někdo založil. " +
                      "Načti stránku znovu a odemkni je heslem.");
                  }
                  obal.sifrovano = novyBlob;
                  if ("polozky" in obal) delete obal.polozky;
                }, null);
              })
              .then(function (obsah) {
                App.uloz(SOUBOR, obsah);
                heslo = zvolene;
                otevrene = { polozky: [] };
                zakladCt = novyBlob.ct;
                modal.zavri();
                App.toast("Náklady založeny.", "ok");
                App.prekresli();
              })
              .catch(function (chyba) {
                probiha = false;
                ohlasChybu(chyba);
              });
          }
        }
      ]
    });
  }

  function vykresliZalozeni(kontejner) {
    var karta = App.el("div", "naklady-zamek");
    karta.appendChild(App.el("h3", "naklady-zamek-nadpis", "Náklady zatím nikdo nezaložil"));
    karta.appendChild(App.el("p", "naklady-zamek-text",
      "Soubor s náklady v datech ještě není. Založením vznikne — obsah bude " +
      "zašifrovaný vlastním heslem, které zná jen ten, kdo ho zadá."));
    var tlacitko = App.el("button", "btn btn-primarni", "Založit náklady");
    tlacitko.type = "button";
    tlacitko.addEventListener("click", otevriZalozeni);
    karta.appendChild(tlacitko);
    kontejner.appendChild(karta);
  }

  // ---- formulář položky ----

  function otevriFormular(existujici) {
    var jeNova = !existujici;
    var form = document.createElement("form");
    form.className = "formular";
    form.addEventListener("submit", function (e) { e.preventDefault(); });

    function pole(popisekText, prvek, napoveda) {
      var obal = App.el("div", "pole");
      var id = "nak-" + Math.random().toString(36).slice(2, 8);
      var popisek = App.el("label", null, popisekText);
      popisek.setAttribute("for", id);
      prvek.id = id;
      prvek.className = (prvek.className ? prvek.className + " " : "") + "vstup";
      obal.appendChild(popisek);
      obal.appendChild(prvek);
      if (napoveda) obal.appendChild(App.el("p", "napoveda", napoveda));
      form.appendChild(obal);
      return prvek;
    }

    var vstupDatum = document.createElement("input");
    vstupDatum.type = "date";
    vstupDatum.value = (existujici && existujici.datum) || new Date().toISOString().slice(0, 10);
    pole("Datum", vstupDatum);

    var vyberKategorie = document.createElement("select");
    KATEGORIE.forEach(function (k) {
      var o = document.createElement("option");
      o.value = k.kod;
      o.textContent = k.nazev;
      vyberKategorie.appendChild(o);
    });
    // Ručně dopsaná kategorie mimo číselník se nesmí tiše přepsat na jinou.
    if (existujici && existujici.kategorie &&
        nazevKategorie(existujici.kategorie) === String(existujici.kategorie)) {
      var cizi = document.createElement("option");
      cizi.value = existujici.kategorie;
      cizi.textContent = existujici.kategorie + " (mimo číselník)";
      vyberKategorie.appendChild(cizi);
    }
    vyberKategorie.value = (existujici && existujici.kategorie) || "doprava";
    pole("Kategorie", vyberKategorie);

    var vstupPopis = document.createElement("input");
    vstupPopis.type = "text";
    vstupPopis.maxLength = 200;
    vstupPopis.value = (existujici && existujici.popis) || "";
    vstupPopis.placeholder = "Za co to bylo";
    pole("Popis", vstupPopis);

    var vstupCastka = document.createElement("input");
    vstupCastka.type = "text";
    vstupCastka.inputMode = "numeric";
    vstupCastka.value = existujici && isFinite(Number(existujici.castka))
      ? String(Math.round(Number(existujici.castka))) : "";
    vstupCastka.placeholder = "480";
    pole("Částka (Kč bez DPH)", vstupCastka, "Celé číslo. Záporné = dobropis.");

    var vstupMnozstvi = document.createElement("input");
    vstupMnozstvi.type = "text";
    vstupMnozstvi.inputMode = "decimal";
    vstupMnozstvi.value = existujici && isFinite(Number(existujici.mnozstvi)) &&
      existujici.mnozstvi !== null && existujici.mnozstvi !== ""
      ? String(existujici.mnozstvi) : "";
    vstupMnozstvi.placeholder = "32";
    pole("Množství (nepovinné)", vstupMnozstvi);

    var vstupJednotka = document.createElement("input");
    vstupJednotka.type = "text";
    vstupJednotka.maxLength = 20;
    vstupJednotka.value = (existujici && existujici.jednotka) || "";
    vstupJednotka.placeholder = "km, hod, ks…";
    pole("Jednotka (nepovinné)", vstupJednotka);

    var vyberNavstevy = document.createElement("select");
    var prazdna = document.createElement("option");
    prazdna.value = "";
    prazdna.textContent = "— nenavazuje na návštěvu —";
    vyberNavstevy.appendChild(prazdna);
    App.polozky("navstevy")
      .filter(function (n) { return n && n.id && !n.smazano; })
      .slice()
      .sort(function (a, b) { return String(b.datum || "").localeCompare(String(a.datum || "")); })
      .forEach(function (n) {
        var o = document.createElement("option");
        o.value = n.id;
        o.textContent = (n.cislo ? "č. " + n.cislo + " — " : "") +
          (n.nazev || "(bez názvu)") + (n.datum ? " (" + Util.formatDatum(n.datum) + ")" : "");
        vyberNavstevy.appendChild(o);
      });
    // Návštěva, která už neexistuje, se nesmí tiše odpojit.
    if (existujici && existujici.navazano_na &&
        !vyberNavstevy.querySelector('option[value="' + existujici.navazano_na + '"]')) {
      var zmizela = document.createElement("option");
      zmizela.value = existujici.navazano_na;
      zmizela.textContent = "(návštěva už neexistuje)";
      vyberNavstevy.appendChild(zmizela);
    }
    vyberNavstevy.value = (existujici && existujici.navazano_na) || "";
    pole("Navázat na návštěvu", vyberNavstevy, "Ať je vidět, co stojí jeden výjezd.");

    var vstupPoznamka = document.createElement("textarea");
    vstupPoznamka.rows = 3;
    vstupPoznamka.value = (existujici && existujici.poznamka) || "";
    pole("Poznámka (nepovinné)", vstupPoznamka);

    // Největší nákladová položka projektu je měsíční provoz dvou kamer po
    // celou stavbu. Bez tohohle by se musel naklikat 36×, což znamená, že by
    // se nezapsal vůbec — a celý souhrn i oba pruhy by lhaly dolů.
    var vstupOpakovat = null;
    if (jeNova) {
      vstupOpakovat = document.createElement("input");
      vstupOpakovat.type = "number";
      vstupOpakovat.min = "1";
      vstupOpakovat.max = "60";
      vstupOpakovat.step = "1";
      vstupOpakovat.value = "1";
      vstupOpakovat.className = "vstup";
      pole("Opakovat měsíčně (počet měsíců)", vstupOpakovat,
        "1 = jednorázový náklad. Víc než 1 založí tolik stejných položek, "
        + "vždy o měsíc dál. Částka platí za jeden měsíc.");
    }

    function sesbirej() {
      var surovaCastka = vstupCastka.value.replace(/\s/g, "").replace(",", ".");
      var surovaMnozstvi = vstupMnozstvi.value.replace(/\s/g, "").replace(",", ".");
      return {
        datum: vstupDatum.value,
        kategorie: vyberKategorie.value,
        popis: vstupPopis.value.trim(),
        castka: surovaCastka === "" ? NaN : Number(surovaCastka),
        mnozstvi: surovaMnozstvi === "" ? null : Number(surovaMnozstvi),
        jednotka: vstupJednotka.value.trim(),
        navazano_na: vyberNavstevy.value || null,
        poznamka: vstupPoznamka.value.trim(),
        opakovat: vstupOpakovat ? Math.round(Number(vstupOpakovat.value) || 1) : 1
      };
    }

    function zkontroluj(data) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.datum)) {
        App.toast("Vyplň datum.", "chyba");
        return false;
      }
      if (data.popis.length < 2) {
        App.toast("Napiš aspoň krátce, za co to bylo.", "chyba");
        return false;
      }
      // Strop je schválně nízko: nejdražší položka projektu jsou kamery
      // v řádu statisíců. Bez něj prošel překlep „přidržená nula“ (1e22)
      // a rozsypal všechna čísla v souhrnu i v procentech.
      if (isFinite(data.castka) && Math.abs(data.castka) > 100000000) {
        App.toast("Částka je nesmyslně velká — zkontroluj počet nul.", "chyba");
        return false;
      }
      if (data.opakovat < 1 || data.opakovat > 60 || !isFinite(data.opakovat)) {
        App.toast("Opakování musí být od 1 do 60 měsíců.", "chyba");
        return false;
      }
      if (!isFinite(data.castka)) {
        App.toast("Částka musí být číslo.", "chyba");
        return false;
      }
      if (data.mnozstvi !== null && !isFinite(data.mnozstvi)) {
        App.toast("Množství musí být číslo (nebo prázdné).", "chyba");
        return false;
      }
      return true;
    }

    var probiha = false;
    var akce = [{ text: "Zavřít", druh: "sekundarni", fn: function () { modal.zavri(); } }];

    if (!jeNova) {
      akce.push({
        text: "Smazat",
        druh: "nebezpecny",
        fn: function () {
          modal.zavri();
          smaz(existujici);
        }
      });
    }

    akce.push({
      text: jeNova ? "Přidat" : "Uložit",
      druh: "primarni",
      fn: function () {
        if (probiha) return;
        var data = sesbirej();
        if (!zkontroluj(data)) return;
        data.castka = Math.round(data.castka);
        probiha = true;
        ulozPolozku(jeNova, existujici, data)
          .then(function (ok) {
            probiha = false;
            if (ok) modal.zavri();
          });
      }
    });

    var modal = App.modal({
      nadpis: jeNova ? "Nová položka nákladů" : "Úprava položky",
      obsah: form,
      akce: akce
    });
    return modal;
  }

  // Posun o N měsíců beze skoků: 31. 1. + 1 měsíc musí dát 28. 2., ne 3. 3.
  // (nativní setMonth přeteče do dalšího měsíce a rozhodilo by to řadu).
  function oMesicuDal(datum, oKolik) {
    var kusy = String(datum).split("-");
    var rok = Number(kusy[0]);
    var mesic = Number(kusy[1]) - 1 + oKolik;
    var den = Number(kusy[2]);
    rok += Math.floor(mesic / 12);
    mesic = ((mesic % 12) + 12) % 12;
    var dnuVMesici = new Date(Date.UTC(rok, mesic + 1, 0)).getUTCDate();
    if (den > dnuVMesici) den = dnuVMesici;
    return rok + "-" + ("0" + (mesic + 1)).slice(-2) + "-" + ("0" + den).slice(-2);
  }

  function ulozPolozku(jeNova, existujici, data) {
    var nove;
    if (jeNova) {
      nove = vsechnyPolozky().slice();
      var kolikrat = Math.max(1, Math.min(60, Math.round(data.opakovat || 1)));
      var ted = new Date().toISOString();
      for (var i = 0; i < kolikrat; i++) {
        nove.push({
          id: GH.noveId("nak"),
          datum: oMesicuDal(data.datum, i),
          kategorie: data.kategorie,
          popis: data.popis,
          castka: data.castka,
          mnozstvi: data.mnozstvi,
          jednotka: data.jednotka,
          // Na návštěvu se váže jen ten první — opakující se náklad
          // (provoz kamer) k jednomu výjezdu nepatří.
          navazano_na: i === 0 ? data.navazano_na : null,
          poznamka: data.poznamka,
          kdo: mojeOsobaId(),
          kdy: ted,
          smazano: null
        });
      }
    } else {
      nove = sePolozkou(existujici.id, function (cil) {
        cil.datum = data.datum;
        cil.kategorie = data.kategorie;
        cil.popis = data.popis;
        cil.castka = data.castka;
        cil.mnozstvi = data.mnozstvi;
        cil.jednotka = data.jednotka;
        cil.navazano_na = data.navazano_na;
        cil.poznamka = data.poznamka;
      });
      // Tiché no-op by zvedlo verzi a člověk by viděl falešné „Uloženo.".
      if (!nove) {
        App.toast("Položka mezitím zmizela — nic se neuložilo. Načti stránku znovu.", "chyba");
        return Promise.resolve(false);
      }
    }
    return zapis(nove)
      .then(function () {
        App.toast(jeNova ? "Položka přidána." : "Uloženo.", "ok");
        App.prekresli();
        return true;
      })
      .catch(function (chyba) {
        ohlasChybu(chyba);
        return false;
      });
  }

  function smaz(polozka) {
    App.potvrd("Smazat položku „" + (polozka.popis || "") + "“ za " + kc(polozka.castka) +
      "? Půjde vrátit dole v seznamu smazaných.").then(function (ano) {
      if (!ano) return;
      var nove = sePolozkou(polozka.id, function (cil) {
        cil.smazano = { kdy: new Date().toISOString(), kdo: mojeOsobaId() };
      });
      if (!nove) {
        App.toast("Položka mezitím zmizela — nic se nesmazalo. Načti stránku znovu.", "chyba");
        return;
      }
      zapis(nove)
        .then(function () {
          App.toast("Smazáno.", "ok");
          App.prekresli();
        })
        .catch(ohlasChybu);
    });
  }

  function vrat(polozka) {
    var nove = sePolozkou(polozka.id, function (cil) { cil.smazano = null; });
    if (!nove) {
      App.toast("Položka mezitím zmizela — nic se nevrátilo. Načti stránku znovu.", "chyba");
      return;
    }
    zapis(nove)
      .then(function () {
        App.toast("Vráceno.", "ok");
        App.prekresli();
      })
      .catch(ohlasChybu);
  }

  // ---- souhrn ----

  function dlazdice(popisek, hodnota, meta, tridaHodnoty) {
    var box = App.el("div", "naklady-dlazdice");
    box.appendChild(App.el("div", "naklady-dlazdice-popisek", popisek));
    box.appendChild(App.el("div", "naklady-dlazdice-cislo" +
      (tridaHodnoty ? " " + tridaHodnoty : ""), hodnota));
    if (meta) box.appendChild(App.el("div", "naklady-dlazdice-meta", meta));
    return box;
  }

  // Kolik měsíců smlouvy už uplynulo (od zahájení po dnešek). Slouží jen
  // k porovnání „utraceno vs. odslouženo" — proto stačí hrubý odhad po dnech.
  function uplynuloMesicu() {
    var n = App.obsah("nastaveni");
    var zahajeni = n && n.zahajeni;
    if (!zahajeni) return null;
    var start = new Date(zahajeni + "T00:00:00Z").getTime();
    if (!isFinite(start)) return null;
    var dnu = (Date.now() - start) / 86400000;
    if (dnu < 0) return 0;
    return dnu / 30.4375;
  }

  // Kolik měsíců stavba SKUTEČNĚ poběží (zahájení -> předání z nastavení).
  // Je to jiné číslo než mesicu_v_nabidce a právě v tom rozdílu je celý vtip.
  function mesicuStavby() {
    var n = App.obsah("nastaveni");
    if (!n || !n.zahajeni || !n.predani) return null;
    var od = new Date(n.zahajeni + "T00:00:00Z").getTime();
    var do_ = new Date(n.predani + "T00:00:00Z").getTime();
    if (!isFinite(od) || !isFinite(do_) || do_ <= od) return null;
    return (do_ - od) / 86400000 / 30.4375;
  }

  function jedenDesetinne(x) {
    return (Math.round(x * 10) / 10).toString().replace(".", ",");
  }

  function vykresliSouhrn(kontejner) {
    var cena = cenaBezDph();
    var naklady = soucet(zive());
    var marze = cena - naklady;

    var mrizka = App.el("div", "naklady-souhrn");
    mrizka.appendChild(dlazdice("Smluvní cena (bez DPH)", kc(cena),
      smlouva().varianta ? "Varianta " + smlouva().varianta : null));
    mrizka.appendChild(dlazdice("Náklady celkem", kc(naklady),
      cena ? procenta(naklady, cena) + " ceny · " + zive().length + " položek"
           : zive().length + " položek"));
    mrizka.appendChild(dlazdice("Hrubá marže", kc(marze), procenta(marze, cena),
      marze < 0 ? "naklady-cislo-spatne" : "naklady-cislo-dobre"));

    // Dřív tu byla dlaždice „Z ceny zbývá“ se STEJNÝM číslem jako marže —
    // dvě jména pro jednu hodnotu. Měsíční průměr je jiná informace a je to
    // zrovna to číslo, kterým se u PORR argumentuje dodatek.
    var uplynulo = uplynuloMesicu();
    var naMesic = (uplynulo && uplynulo > 0.5) ? naklady / uplynulo : null;
    mrizka.appendChild(dlazdice("Náklady na měsíc",
      naMesic === null ? "—" : kc(Math.round(naMesic)),
      naMesic === null ? "zatím málo dat"
        : "průměr za " + jedenDesetinne(uplynulo) + " měsíce provozu"));
    kontejner.appendChild(mrizka);

    // Dva pruhy pod sebou: kolik peněz je utraceno vs. kolik smlouvy odbyto.
    // Když je horní pruh delší než spodní, utrácí se rychleji, než běží čas.
    // POZOR na past, kvůli které tenhle pruh dřív lhal: měřil čas proti
    // mesicu_v_nabidce (28), jenže stavba běží od zahájení do předání
    // (~36 měsíců). Od ledna 2029 by pruh hlásil 100 % a „drží krok s časem“,
    // zatímco kamery by jely dál bez jediné koruny navíc. Měříme proto proti
    // SKUTEČNÉ délce a rozdíl pojmenujeme.
    var stavba = mesicuStavby();
    var veSmlouve = Number(smlouva().mesicu_v_nabidce) || 0;
    if (cena > 0 && stavba && uplynulo !== null) {
      var podilPenez = Math.max(0, Math.min(1, naklady / cena));
      var podilCasu = Math.max(0, Math.min(1, uplynulo / stavba));
      var box = App.el("div", "naklady-tempo");
      box.appendChild(pruhTempa("Utraceno z ceny", podilPenez, "naklady-pruh-penize"));
      box.appendChild(pruhTempa("Uplynulo ze stavby", podilCasu, "naklady-pruh-cas"));
      box.appendChild(App.el("p", "napoveda", podilPenez > podilCasu + 0.05
        ? "Náklady jdou napřed před časem — utrácí se rychleji, než stavba běží."
        : "Náklady drží krok s časem."));
      if (veSmlouve && stavba - veSmlouve > 0.5) {
        var rozdil = stavba - veSmlouve;
        var varovani = App.el("p", "naklady-varovani");
        varovani.appendChild(App.el("strong", null, "Smlouva nepokrývá celou stavbu. "));
        varovani.appendChild(document.createTextNode(
          "Nabídka je na " + veSmlouve + " měsíců, stavba poběží zhruba "
          + jedenDesetinne(stavba) + " — o " + jedenDesetinne(rozdil)
          + " měsíce déle. Náklady na ten zbytek nejsou v ceně."));
        box.appendChild(varovani);
      }
      kontejner.appendChild(box);
    }
  }

  function pruhTempa(popisek, podil, trida) {
    var radek = App.el("div", "naklady-tempo-radek");
    radek.appendChild(App.el("span", "naklady-tempo-popisek", popisek));
    var drazka = App.el("span", "naklady-pruh");
    var vypln = App.el("span", "naklady-pruh-vypln " + trida);
    vypln.style.width = (Math.round(podil * 1000) / 10) + "%";
    drazka.appendChild(vypln);
    radek.appendChild(drazka);
    radek.appendChild(App.el("span", "naklady-tempo-hodnota",
      (Math.round(podil * 1000) / 10).toString().replace(".", ",") + " %"));
    return radek;
  }

  // ---- rozpad po kategoriích ----

  function vykresliKategorie(kontejner) {
    var polozky = zive();
    if (!polozky.length) return;
    var celkem = soucet(polozky);

    var poradi = KATEGORIE.map(function (k) { return k.kod; });
    polozky.forEach(function (p) {
      if (poradi.indexOf(p.kategorie) === -1) poradi.push(p.kategorie);
    });

    var box = App.el("div", "oddil");
    box.appendChild(App.el("h3", "naklady-podnadpis", "Rozpad po kategoriích"));
    var seznam = App.el("div", "naklady-kategorie");

    poradi.forEach(function (kod) {
      var vKategorii = polozky.filter(function (p) { return p.kategorie === kod; });
      if (!vKategorii.length) return;
      var castka = soucet(vKategorii);
      var radek = App.el("div", "naklady-kategorie-radek");
      radek.appendChild(App.el("span", "naklady-kategorie-nazev", nazevKategorie(kod)));
      var drazka = App.el("span", "naklady-pruh");
      var vypln = App.el("span", "naklady-pruh-vypln naklady-pruh-penize");
      vypln.style.width = (celkem ? Math.max(1, (castka / celkem) * 100) : 0) + "%";
      drazka.appendChild(vypln);
      radek.appendChild(drazka);
      radek.appendChild(App.el("span", "naklady-kategorie-castka", kc(castka)));
      radek.appendChild(App.el("span", "naklady-kategorie-podil", procenta(castka, celkem)));
      seznam.appendChild(radek);
    });

    box.appendChild(seznam);
    kontejner.appendChild(box);
  }

  // ---- co stojí jeden výjezd ----

  function vykresliPoNavstevach(kontejner) {
    var navazane = zive().filter(function (p) { return p.navazano_na; });
    if (!navazane.length) return;

    var mapa = {};
    var poradi = [];
    navazane.forEach(function (p) {
      if (!mapa[p.navazano_na]) {
        mapa[p.navazano_na] = [];
        poradi.push(p.navazano_na);
      }
      mapa[p.navazano_na].push(p);
    });

    var box = App.el("div", "oddil");
    box.appendChild(App.el("h3", "naklady-podnadpis", "Co stojí jeden výjezd"));
    var seznam = App.el("div", "naklady-vyjezdy");
    poradi
      .sort(function (a, b) { return soucet(mapa[b]) - soucet(mapa[a]); })
      .forEach(function (id) {
        var radek = App.el("div", "naklady-vyjezd");
        radek.appendChild(App.el("span", "naklady-vyjezd-nazev", nazevNavstevy(id)));
        radek.appendChild(App.el("span", "naklady-vyjezd-meta",
          mapa[id].length + (mapa[id].length === 1 ? " položka" : " položky")));
        radek.appendChild(App.el("span", "naklady-vyjezd-castka", kc(soucet(mapa[id]))));
        seznam.appendChild(radek);
      });
    box.appendChild(seznam);
    kontejner.appendChild(box);
  }

  // ---- filtry + seznam ----

  function filtrovane() {
    return zive().filter(function (p) {
      if (filtrKategorie !== "vse" && p.kategorie !== filtrKategorie) return false;
      if (filtrRok !== "vse" && rok(p) !== filtrRok) return false;
      return true;
    }).sort(function (a, b) {
      var podleData = String(b.datum || "").localeCompare(String(a.datum || ""));
      if (podleData) return podleData;
      return String(b.kdy || "").localeCompare(String(a.kdy || ""));
    });
  }

  function vykresliFiltry(kontejner) {
    var pruh = App.el("div", "naklady-filtry");

    var vyberKategorie = document.createElement("select");
    vyberKategorie.className = "vstup naklady-filtr-vyber";
    vyberKategorie.setAttribute("aria-label", "Filtr podle kategorie");
    var vseK = document.createElement("option");
    vseK.value = "vse";
    vseK.textContent = "Všechny kategorie";
    vyberKategorie.appendChild(vseK);
    var pouzite = [];
    zive().forEach(function (p) {
      if (pouzite.indexOf(p.kategorie) === -1) pouzite.push(p.kategorie);
    });
    KATEGORIE.forEach(function (k) {
      if (pouzite.indexOf(k.kod) === -1) return;
      var o = document.createElement("option");
      o.value = k.kod;
      o.textContent = k.nazev;
      vyberKategorie.appendChild(o);
    });
    pouzite.forEach(function (kod) {
      if (nazevKategorie(kod) !== String(kod)) return; // už je v číselníku
      var o = document.createElement("option");
      o.value = kod;
      o.textContent = kod;
      vyberKategorie.appendChild(o);
    });
    if (filtrKategorie !== "vse" && pouzite.indexOf(filtrKategorie) === -1) {
      filtrKategorie = "vse"; // po smazání poslední položky kategorie
    }
    vyberKategorie.value = filtrKategorie;
    vyberKategorie.addEventListener("change", function () {
      filtrKategorie = vyberKategorie.value;
      App.prekresli();
    });
    pruh.appendChild(vyberKategorie);

    var vyberRok = document.createElement("select");
    vyberRok.className = "vstup naklady-filtr-vyber";
    vyberRok.setAttribute("aria-label", "Filtr podle roku");
    var vseR = document.createElement("option");
    vseR.value = "vse";
    vseR.textContent = "Všechny roky";
    vyberRok.appendChild(vseR);
    var roky = [];
    zive().forEach(function (p) {
      var r = rok(p);
      if (r && roky.indexOf(r) === -1) roky.push(r);
    });
    roky.sort().reverse().forEach(function (r) {
      var o = document.createElement("option");
      o.value = r;
      o.textContent = r;
      vyberRok.appendChild(o);
    });
    if (filtrRok !== "vse" && roky.indexOf(filtrRok) === -1) filtrRok = "vse";
    vyberRok.value = filtrRok;
    vyberRok.addEventListener("change", function () {
      filtrRok = vyberRok.value;
      App.prekresli();
    });
    pruh.appendChild(vyberRok);

    kontejner.appendChild(pruh);
  }

  function bunka(radek, text, trida) {
    var td = document.createElement("td");
    if (trida) td.className = trida;
    td.textContent = text;
    radek.appendChild(td);
    return td;
  }

  function vykresliSeznam(kontejner) {
    var seznam = filtrovane();
    var vsech = zive().length;

    var souhrnRadek = App.el("p", "naklady-soucet");
    souhrnRadek.appendChild(App.el("strong", null, "Součet vyfiltrovaného: " + kc(soucet(seznam))));
    souhrnRadek.appendChild(document.createTextNode(
      " \u00b7 " + seznam.length + " z " + vsech + " položek"));
    kontejner.appendChild(souhrnRadek);

    if (!seznam.length) {
      var prazdno = App.el("div", "prazdny-stav");
      prazdno.appendChild(App.el("p", "prazdny-stav-text", vsech
        ? "Tomuhle filtru neodpovídá žádná položka."
        : "Zatím tu není žádný náklad. Přidej první — třeba dopravu na první výjezd."));
      kontejner.appendChild(prazdno);
      return;
    }

    var obal = App.el("div", "tabulka-wrap");
    var tabulka = document.createElement("table");
    tabulka.className = "tabulka-naklady";

    var hlavicka = document.createElement("tr");
    ["Datum", "Kategorie", "Popis", "Množství", "Částka", "Návštěva", ""].forEach(function (t) {
      var th = document.createElement("th");
      th.textContent = t;
      hlavicka.appendChild(th);
    });
    var thead = document.createElement("thead");
    thead.appendChild(hlavicka);
    tabulka.appendChild(thead);

    var telo = document.createElement("tbody");
    seznam.forEach(function (p) {
      var radek = document.createElement("tr");
      bunka(radek, p.datum ? Util.formatDatum(p.datum) : "—", "naklady-bunka-datum");
      bunka(radek, nazevKategorie(p.kategorie));
      var popisBunka = bunka(radek, p.popis || "—", "naklady-bunka-popis");
      if (p.poznamka) {
        popisBunka.appendChild(App.el("div", "naklady-poznamka", p.poznamka));
      }
      bunka(radek, (p.mnozstvi === null || p.mnozstvi === undefined || p.mnozstvi === "")
        ? "—"
        : String(p.mnozstvi).replace(".", ",") + (p.jednotka ? " " + p.jednotka : ""),
        "naklady-bunka-cislo");
      bunka(radek, kc(p.castka), "naklady-bunka-cislo naklady-bunka-castka");
      bunka(radek, p.navazano_na ? nazevNavstevy(p.navazano_na) : "—", "naklady-bunka-navsteva");

      var akce = document.createElement("td");
      akce.className = "naklady-bunka-akce";
      var btnUprav = App.el("button", "btn btn-mala btn-sekundarni", "Upravit");
      btnUprav.type = "button";
      btnUprav.addEventListener("click", function () { otevriFormular(p); });
      akce.appendChild(btnUprav);
      radek.appendChild(akce);

      telo.appendChild(radek);
    });
    tabulka.appendChild(telo);
    obal.appendChild(tabulka);
    kontejner.appendChild(obal);
  }

  // ---- smazané (vlastní koš téhle sekce) ----

  function vykresliSmazane(kontejner) {
    var pryc = smazane();
    if (!pryc.length) return;

    var box = App.el("div", "oddil");
    var prepinac = App.el("button", "odkaz-tlacitko",
      (ukazSmazane ? "Skrýt" : "Zobrazit") + " smazané položky (" + pryc.length + ")");
    prepinac.type = "button";
    prepinac.addEventListener("click", function () {
      ukazSmazane = !ukazSmazane;
      App.prekresli();
    });
    box.appendChild(prepinac);

    if (ukazSmazane) {
      box.appendChild(App.el("p", "napoveda",
        "Smazané náklady se vracejí tady, ne ve společném Koši — ten čte " +
        "otevřené soubory, které vidí celý tým."));
      var seznam = App.el("div", "naklady-smazane");
      pryc
        .slice()
        .sort(function (a, b) {
          return String((b.smazano && b.smazano.kdy) || "")
            .localeCompare(String((a.smazano && a.smazano.kdy) || ""));
        })
        .forEach(function (p) {
          var radek = App.el("div", "naklady-smazany");
          radek.appendChild(App.el("span", "naklady-smazany-popis",
            (p.datum || "") + " · " + nazevKategorie(p.kategorie) + " · " + (p.popis || "—")));
          radek.appendChild(App.el("span", "naklady-smazany-castka", kc(p.castka)));
          radek.appendChild(App.el("span", "naklady-smazany-meta",
            "smazal " + App.jmenoOsoby(p.smazano && p.smazano.kdo)));
          var btn = App.el("button", "btn btn-mala btn-sekundarni", "Vrátit");
          btn.type = "button";
          btn.addEventListener("click", function () { vrat(p); });
          radek.appendChild(btn);
          seznam.appendChild(radek);
        });
      box.appendChild(seznam);
    }

    kontejner.appendChild(box);
  }

  // ---- hlavní vykreslení ----

  function vykresli(kontejner) {
    kontejner.innerHTML = "";

    var hlavicka = App.el("div", "sekce-hlavicka");
    hlavicka.appendChild(App.el("h2", "nadpis-sekce", "Náklady na provoz"));
    kontejner.appendChild(hlavicka);
    zaregistrujHlidaniRole();
    zpristupniPrehledu();

    // Pojistka pro případ, že by sem někdo dorazil jinudy než routerem
    // (ten to hlídá v maPravoNaSekci). Data se nezobrazí tak jako tak —
    // bez hesla není co ukázat.
    if (!jeSuperadmin()) {
      zapomenHeslo();
      kontejner.appendChild(App.el("p", "podnadpis-sekce",
        "Tuhle sekci vidí jen super admin."));
      return;
    }

    kontejner.appendChild(App.el("p", "podnadpis-sekce",
      "Vidíš to jen ty. Obsah je v datech zašifrovaný vlastním heslem — " +
      "token do repa má sice celý tým, ale přečíst tohle bez hesla nejde."));

    var blob = sifra();

    if (!blob) {
      // Soubor v repu (ještě) není. Rozšifrovaný stav v paměti by tu zůstal
      // viset po smazání souboru — radši ho zahodit.
      otevrene = null;
      zakladCt = null;
      vykresliZalozeni(kontejner);
      return;
    }

    if (!heslo) {
      vykresliZamek(kontejner);
      return;
    }

    // Blob se změnil pod rukama (polling, jiná záložka) — rozšifrovat znovu
    // heslem, které už v paměti je.
    if (!otevrene || zakladCt !== blob.ct) {
      kontejner.appendChild(App.el("p", "podnadpis-sekce", "Rozšifrovávám…"));
      if (!desifrovaniBezi) {
        desifrovaniBezi = true;
        zkusOdemknout(heslo)
          .then(function (ok) {
            desifrovaniBezi = false;
            if (!ok) {
              heslo = null;
              otevrene = null;
              zakladCt = null;
              App.toast("Náklady se nepodařilo rozšifrovat — zadej heslo znovu.", "chyba");
            }
            App.prekresli();
          })
          .catch(function () {
            desifrovaniBezi = false;
            heslo = null;
            App.toast("Rozšifrování se nepovedlo.", "chyba");
            App.prekresli();
          });
      }
      return;
    }

    var pruhAkci = App.el("div", "karta-akce");
    var btnNova = App.el("button", "btn btn-primarni", "+ Přidat náklad");
    btnNova.type = "button";
    btnNova.addEventListener("click", function () { otevriFormular(null); });
    pruhAkci.appendChild(btnNova);
    var btnZamek = App.el("button", "btn btn-sekundarni", "Zamknout");
    btnZamek.type = "button";
    btnZamek.addEventListener("click", zamkni);
    pruhAkci.appendChild(btnZamek);
    kontejner.appendChild(pruhAkci);

    // Nabídka přesunu se ukáže jen dokud je co přesouvat.
    if (jeCoMigrovat()) {
      var vyzva = App.el("div", "naklady-varovani");
      vyzva.appendChild(App.el("strong", null,
        "Smluvní cena a interní upozornění leží zatím v otevřených datech. "));
      vyzva.appendChild(document.createTextNode(
        "Přečte si je kdokoli z týmu, kdo má přístup do datového repozitáře — "
        + "tedy i lidé investora a zhotovitele. Přesunem se zašifrují stejným "
        + "heslem jako náklady a uvidíš je jen ty."));
      var btnPresun = App.el("button", "btn btn-primarni", "Přesunout interní čísla do šifry");
      btnPresun.type = "button";
      var presunBezi = false;
      btnPresun.addEventListener("click", function () {
        if (presunBezi) return;   // dvojklik by zapisoval dvakrát
        presunBezi = true;
        btnPresun.disabled = true;
        btnPresun.textContent = "Přesouvám…";
        presunDoSifry().then(function () { presunBezi = false; })
          .catch(function () {
            presunBezi = false;
            btnPresun.disabled = false;
            btnPresun.textContent = "Přesunout interní čísla do šifry";
          });
      });
      vyzva.appendChild(document.createElement("br"));
      vyzva.appendChild(btnPresun);
      kontejner.appendChild(vyzva);
    }

    vykresliSouhrn(kontejner);
    vykresliKategorie(kontejner);
    vykresliPoNavstevach(kontejner);
    vykresliFiltry(kontejner);
    vykresliSeznam(kontejner);
    vykresliSmazane(kontejner);
  }

  // Přístupové funkce registrujeme HNED při načtení, ne až při vykreslení
  // sekce. Přehled je výchozí sekce a potřebuje aspoň poznat, že je zamčeno —
  // jinak by se superadminovi neukázal ani odkaz, kde si to odemkne.
  zpristupniPrehledu();

  App.registrujSekci("naklady", vykresli);
})();
