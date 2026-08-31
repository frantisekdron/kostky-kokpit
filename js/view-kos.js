/*
 * view-kos.js — sekce "Koš" (KONTRAKT.md §9.6).
 *
 * Projde všechny datové soubory, které mohou mít soft-delete (navstevy, plan,
 * materialy, lide, aktivita, casosber, pripominky), a vypíše položky s vyplněným
 * `smazano`, seskupené podle typu. U každé ukáže, kdo a kdy smazal
 * (App.jmenoOsoby). "Obnovit" (právo kos.obnovit) vrátí smazano na null.
 * "Smazat trvale" (právo kos.vysypat, s potvrzením) položku ze souboru trvale
 * odstraní. Nahoře tlačítko "Vysypat celý koš" (kos.vysypat, důrazné potvrzení).
 *
 * Kromě položek na NEJVYŠŠÍ úrovni souboru (seznam SEKCE) umí koš i úroveň
 * VNOŘENOU (seznam VNORENE) — dnes odpovědi u připomínek, tedy
 * pripominky.polozky[].odpovedi[]. Vnořený záznam se v koši adresuje dvojicí
 * id rodiče + id záznamu (data-rodic + data-id) a mutuje se VÝHRADNĚ podle
 * těchto id, nikdy podle pozice v poli.
 *
 * Čte App.polozky(<soubor>) (u těchto souborů vždy pole položek — App.data drží
 * VŽDY celou obálku, proto se nikdy nesahá na App.data[soubor] přímo, viz
 * hlavičkový komentář js/app.js), zapisuje přes GH.zmen a po úspěchu uloží celou
 * vrácenou obálku pomocí App.uloz(soubor, obsah). Používá App.potvrd / App.toast /
 * App.prekresli / App.jmenoOsoby přesně podle API v js/app.js.
 *
 * Nevystavuje žádný nový globální objekt — jen se při načtení stránky
 * zaregistruje jako sekce "kos" přes App.registrujSekci().
 */

(function () {
  "use strict";

  var esc = Util.esc;

  // Soubory prohledávané košem — §9.6 kontraktu + casosber z dodatku §A.
  // (Dodatek zavedl data/casosber.json se stejným mechanismem `smazano`, ale
  // jeho průřezový seznam úprav v §C na Koš zapomněl. Doplněno při integraci —
  // bez toho by smazané místo pro kameru zmizelo bez možnosti obnovy.)
  var SEKCE = [
    {
      soubor: "navstevy",
      nazevTypu: "Návštěvy",
      nazev: function (p) { return (p.cislo ? "Návštěva č. " + p.cislo + " — " : "") + (p.nazev || "(bez názvu)"); }
    },
    {
      soubor: "plan",
      nazevTypu: "Plán stavby (milníky)",
      nazev: function (p) { return p.nazev || "(bez názvu)"; }
    },
    {
      soubor: "materialy",
      nazevTypu: "Materiály",
      nazev: function (p) { return p.nazev || "(bez názvu)"; }
    },
    {
      soubor: "lide",
      nazevTypu: "Tým",
      nazev: function (p) { return p.jmeno || "(bez jména)"; }
    },
    {
      soubor: "aktivita",
      nazevTypu: "Aktivita a komentáře",
      nazev: function (p) { return p.text || "(bez textu)"; }
    },
    {
      soubor: "casosber",
      nazevTypu: "Časosběr — místa pro kameru",
      nazev: function (p) { return p.nazev || "(bez názvu)"; }
    },
    {
      soubor: "pripominky",
      nazevTypu: "Připomínky",
      nazev: function (p) {
        return (p.cislo ? "č. " + p.cislo + " — " : "") + (p.nazev || "(bez názvu)");
      }
    }
  ];

  // Vnořené úrovně — záznamy, které nejsou položkou souboru, ale žijí v poli
  // UVNITŘ položky (polozky[].<pole>[]) a mají vlastní `smazano`. Bez tohohle
  // seznamu by měkce smazaná odpověď u připomínky zmizela bez možnosti obnovy.
  // `nazev` dělá nadpis řádku, `detail` doplňkový řádek s náhledem textu.
  var VNORENE = [
    {
      soubor: "pripominky",
      pole: "odpovedi",
      nazevTypu: "Odpovědi u připomínek",
      nazev: function (odp, rodic) {
        if (!rodic) return "Odpověď u připomínky";
        if (rodic.cislo) return "Odpověď v připomínce č. " + rodic.cislo;
        return "Odpověď v připomínce „" + (rodic.nazev || "bez názvu") + "“";
      },
      detail: function (odp) { return zkrat(odp.text, 140); }
    }
  ];

  // ---- tenké obaly nad společnými App.polozky()/App.uloz() (js/app.js) ----

  function polozkyZeSouboru(soubor) {
    return App.polozky(soubor);
  }

  function ulozDoAppData(soubor, obsah) {
    App.uloz(soubor, obsah);
  }

  // GH.zmen nepředává mutátoru u všech souborů pole položek: u souborů
  // s "rozšířenou obálkou" (casosber.json má vedle "polozky" ještě blok
  // "popisy", viz ROZSIRENA_OBALKA v js/gh.js) dostane CELOU obálku. Koš
  // pracuje vždycky se seznamem položek, takže si ho vytáhne tímhle
  // tolerantním obalem — stejně, jako to při čtení dělá App.polozky().
  // (Bez toho házelo obnovení časosběrného místa TypeError, který se navenek
  // tvářil jako „Bez připojení. Změna se neuložila.“, a vysypání koše u
  // časosběru tiše nic neudělalo.)
  function seznam(mutovatelna) {
    if (Array.isArray(mutovatelna)) return mutovatelna;
    if (mutovatelna && Array.isArray(mutovatelna.polozky)) return mutovatelna.polozky;
    return [];
  }

  function zkrat(text, limit) {
    var t = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
    if (!t) return "(bez textu)";
    return t.length > limit ? t.slice(0, limit - 1) + "…" : t;
  }

  // Jeden řádek koše ve tvaru, který si vykreslení i akce umí přebrat bez
  // ohledu na to, jestli přišel z nejvyšší nebo z vnořené úrovně.
  function zaznam(id, rodicId, popisek, detail, poznamka, smazano) {
    return {
      id: id,
      rodicId: rodicId || "",
      popisek: popisek,
      detail: detail || "",
      poznamka: poznamka || "",
      smazano: smazano || {}
    };
  }

  function smazaneTop(s) {
    return polozkyZeSouboru(s.soubor)
      .filter(function (p) { return !!p.smazano; })
      .map(function (p) { return zaznam(p.id, "", s.nazev(p), "", "", p.smazano); });
  }

  function smazaneVnorene(v) {
    var vysledek = [];
    polozkyZeSouboru(v.soubor).forEach(function (rodic) {
      var pole = Array.isArray(rodic[v.pole]) ? rodic[v.pole] : [];
      pole.forEach(function (z) {
        if (!z || !z.smazano) return;
        // Bez id se záznam nedá adresovat a obnovit by šel jen podle pozice,
        // což se dělat nesmí — takový (nikdy nemá vzniknout) se přeskočí.
        if (!z.id) return;
        vysledek.push(
          zaznam(
            z.id,
            rodic.id,
            v.nazev(z, rodic),
            v.detail ? v.detail(z, rodic) : "",
            // Když je v koši i celá připomínka, obnovení samotné odpovědi ji
            // ještě nezviditelní — ať to člověk ví předem.
            rodic.smazano ? "nadřazená připomínka je taky v koši" : "",
            z.smazano
          )
        );
      });
    });
    return vysledek;
  }

  // Skupiny do výpisu: nejdřív nejvyšší úroveň v pořadí SEKCE, pak vnořené
  // (odpovědi u připomínek vyjdou hned za skupinou Připomínky).
  function smazaneSkupiny() {
    var skupiny = SEKCE.map(function (s) {
      return {
        soubor: s.soubor,
        pole: "",
        nazevTypu: s.nazevTypu,
        polozky: smazaneTop(s)
      };
    }).concat(
      VNORENE.map(function (v) {
        return {
          soubor: v.soubor,
          pole: v.pole,
          nazevTypu: v.nazevTypu,
          polozky: smazaneVnorene(v)
        };
      })
    );
    return skupiny.filter(function (g) { return g.polozky.length > 0; });
  }

  function formatKdy(iso) {
    if (!iso) return "";
    return Util.formatCas(iso) + " h";
  }

  // ---- vykreslení ----

  function vykresli(kontejnerParam) {
    var kontejner = kontejnerParam || document.getElementById("obsah");
    if (!kontejner) return;

    var smiObnovit = Auth.can("kos.obnovit");
    var smiVysypat = Auth.can("kos.vysypat");
    var skupiny = smazaneSkupiny();
    var celkem = skupiny.reduce(function (soucet, g) { return soucet + g.polozky.length; }, 0);

    var html = '<div class="sekce-hlava"><h2>Koš' + (celkem ? " (" + celkem + ")" : "") + "</h2>";
    if (smiVysypat && celkem > 0) {
      html += '<button type="button" class="btn btn-nebezpecny" data-akce="vysypat-vse">Vysypat celý koš</button>';
    }
    html += "</div>";

    if (!celkem) {
      html += '<div class="prazdny-stav"><p>Koš je prázdný. Nic tu není ke smazání.</p></div>';
    } else {
      skupiny.forEach(function (g) {
        html += '<section class="skupina-kos">';
        html += '<h3 class="skupina-nadpis">' + esc(g.nazevTypu) + ' <span class="pocitadlo">' + g.polozky.length + "</span></h3>";
        html += '<div class="seznam-kos">';
        g.polozky.forEach(function (z) {
          var kdo = z.smazano.kdo ? App.jmenoOsoby(z.smazano.kdo) : "—";
          var kdy = formatKdy(z.smazano.kdy);
          var adresa =
            ' data-soubor="' + esc(g.soubor) + '"' +
            ' data-id="' + esc(z.id) + '"' +
            (g.pole ? ' data-pole="' + esc(g.pole) + '" data-rodic="' + esc(z.rodicId) + '"' : "");
          html +=
            '<article class="radek-kos"' + adresa + ">" +
            '<div class="radek-kos-text">' +
            "<strong>" + esc(z.popisek) + "</strong>" +
            (z.detail ? '<span class="radek-kos-meta">' + esc(z.detail) + "</span>" : "") +
            '<span class="radek-kos-meta">smazal(a) ' + esc(kdo) + " · " + esc(kdy) +
            (z.poznamka ? " · " + esc(z.poznamka) : "") +
            "</span>" +
            "</div>" +
            '<div class="radek-kos-akce">' +
            (smiObnovit ? '<button type="button" class="btn btn-mala btn-sekundarni" data-akce="obnovit"' + adresa + ">Obnovit</button>" : "") +
            (smiVysypat ? '<button type="button" class="btn btn-mala btn-nebezpecny" data-akce="vysypat"' + adresa + ">Smazat trvale</button>" : "") +
            "</div>" +
            "</article>";
        });
        html += "</div></section>";
      });
    }

    kontejner.innerHTML = html;
    napojPosluchace(kontejner);
  }

  // ---- posluchač: delegace na sdíleném #obsah, viz vysvětlení v view-lide.js ----

  function napojPosluchace(kontejner) {
    kontejner.dataset.aktivniSekce = "kos";
    if (kontejner._kosNapojeno) return;
    kontejner._kosNapojeno = true;
    kontejner.addEventListener("click", function (e) {
      if (kontejner.dataset.aktivniSekce !== "kos") return;
      var btn = e.target.closest("[data-akce]");
      if (!btn) return;
      var akce = btn.dataset.akce;
      var soubor = btn.dataset.soubor;
      var id = btn.dataset.id;
      var pole = btn.dataset.pole || "";
      var rodic = btn.dataset.rodic || "";
      if (akce === "obnovit") obnovitPolozku(soubor, id, pole, rodic);
      else if (akce === "vysypat") smazatTrvale(soubor, id, pole, rodic);
      else if (akce === "vysypat-vse") vysypatVse();
    });
  }

  // ---- adresování záznamu VŽDY podle id (u vnořených podle id rodiče i id
  //      záznamu), nikdy podle pozice v poli ----

  function najdiVnorenouKonfiguraci(soubor, pole) {
    return VNORENE.find(function (v) { return v.soubor === soubor && v.pole === pole; });
  }

  function najdiZaznam(polozky, id, pole, rodicId) {
    if (!pole) {
      return polozky.find(function (x) { return x && x.id === id; }) || null;
    }
    var rodic = polozky.find(function (x) { return x && x.id === rodicId; });
    if (!rodic || !Array.isArray(rodic[pole])) return null;
    return rodic[pole].find(function (x) { return x && x.id === id; }) || null;
  }

  function odeberZaznam(polozky, id, pole, rodicId) {
    if (!pole) {
      var idx = polozky.findIndex(function (x) { return x && x.id === id; });
      if (idx !== -1) polozky.splice(idx, 1);
      return;
    }
    var rodic = polozky.find(function (x) { return x && x.id === rodicId; });
    if (!rodic || !Array.isArray(rodic[pole])) return;
    var idxVnoreny = rodic[pole].findIndex(function (x) { return x && x.id === id; });
    if (idxVnoreny !== -1) rodic[pole].splice(idxVnoreny, 1);
  }

  function najdiPopisek(soubor, id, pole, rodicId) {
    if (pole) {
      var v = najdiVnorenouKonfiguraci(soubor, pole);
      var rodic = polozkyZeSouboru(soubor).find(function (x) { return x && x.id === rodicId; });
      var z = najdiZaznam(polozkyZeSouboru(soubor), id, pole, rodicId);
      if (!v || !z) return id;
      var popis = v.nazev(z, rodic);
      var detail = v.detail ? v.detail(z, rodic) : "";
      return detail ? popis + " — " + detail : popis;
    }
    var s = SEKCE.find(function (x) { return x.soubor === soubor; });
    var p = polozkyZeSouboru(soubor).find(function (x) { return x && x.id === id; });
    return p && s ? s.nazev(p) : id;
  }

  function obnovitPolozku(soubor, id, pole, rodicId) {
    var popisek = najdiPopisek(soubor, id, pole, rodicId);
    GH.zmen(
      soubor,
      function (mutovatelna) {
        var z = najdiZaznam(seznam(mutovatelna), id, pole, rodicId);
        if (z) z.smazano = null;
      },
      "Obnoveno z koše — " + popisek
    )
      .then(function (obsah) {
        ulozDoAppData(soubor, obsah);
        App.toast("Obnoveno z koše.", "ok");
        App.prekresli();
      })
      .catch(function (chyba) {
        App.toast((chyba && chyba.hlaska) || "Obnovení se nepovedlo.", "chyba");
      });
  }

  function smazatTrvale(soubor, id, pole, rodicId) {
    var popisek = najdiPopisek(soubor, id, pole, rodicId);
    App.potvrd('Opravdu trvale smazat „' + popisek + '“? Tuto akci nelze vrátit zpět.').then(function (ano) {
      if (!ano) return;
      GH.zmen(
        soubor,
        function (mutovatelna) {
          odeberZaznam(seznam(mutovatelna), id, pole, rodicId);
        },
        "Trvale smazáno — " + popisek
      )
        .then(function (obsah) {
          ulozDoAppData(soubor, obsah);
          App.toast("Trvale smazáno.", "ok");
          App.prekresli();
        })
        .catch(function (chyba) {
          App.toast((chyba && chyba.hlaska) || "Trvalé smazání se nepovedlo.", "chyba");
        });
    });
  }

  // Vysypání JEDNOHO souboru: nejdřív pryč s celými smazanými položkami
  // (jejich vnořené záznamy odejdou s nimi), a u těch zbylých ještě pryč
  // s měkce smazanými záznamy ve vnořených polích.
  function vysypVnorenaPole(polozka, vnorene) {
    vnorene.forEach(function (v) {
      var pole = polozka[v.pole];
      if (!Array.isArray(pole)) return;
      for (var j = pole.length - 1; j >= 0; j--) {
        if (pole[j] && pole[j].smazano) pole.splice(j, 1);
      }
    });
  }

  function vysypSoubor(soubor) {
    var vnorene = VNORENE.filter(function (v) { return v.soubor === soubor; });
    return function (mutovatelna) {
      var polozky = seznam(mutovatelna);
      for (var i = polozky.length - 1; i >= 0; i--) {
        var p = polozky[i];
        if (!p) continue;
        if (p.smazano) {
          polozky.splice(i, 1);
          continue;
        }
        if (vnorene.length) vysypVnorenaPole(p, vnorene);
      }
    };
  }

  function vysypatVse() {
    var skupiny = smazaneSkupiny();
    var celkem = skupiny.reduce(function (soucet, g) { return soucet + g.polozky.length; }, 0);
    if (!celkem) return;

    App.potvrd("Opravdu trvale smazat VŠECH " + celkem + " položek v koši ze všech kategorií? Tuto akci nelze vrátit zpět.").then(function (ano) {
      if (!ano) return;

      // Jeden zápis na SOUBOR, ne na skupinu: připomínky mají v koši dvě
      // skupiny (samotné připomínky + odpovědi) a psát do jednoho souboru
      // dvakrát by znamenalo zbytečný druhý read-modify-write.
      var soubory = [];
      var popisky = {};
      skupiny.forEach(function (g) {
        if (soubory.indexOf(g.soubor) === -1) {
          soubory.push(g.soubor);
          popisky[g.soubor] = [];
        }
        popisky[g.soubor].push(g.nazevTypu);
      });

      var chyby = [];
      var retez = Promise.resolve();
      soubory.forEach(function (soubor) {
        var popis = popisky[soubor].join(", ");
        retez = retez
          .then(function () {
            return GH.zmen(soubor, vysypSoubor(soubor), "Vysypán koš — " + popis);
          })
          .then(function (obsah) {
            ulozDoAppData(soubor, obsah);
          })
          .catch(function (chyba) {
            chyby.push(popis + ": " + ((chyba && chyba.hlaska) || "chyba"));
          });
      });

      retez.then(function () {
        App.prekresli();
        if (chyby.length) {
          App.toast("Část koše se nepodařilo vysypat: " + chyby.join("; "), "chyba");
        } else {
          App.toast("Koš vysypán.", "ok");
        }
      });
    });
  }

  App.registrujSekci("kos", vykresli);
})();
