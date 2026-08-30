/*
 * view-kos.js — sekce "Koš" (KONTRAKT.md §9.6).
 *
 * Projde všechny datové soubory, které mohou mít soft-delete (navstevy, plan,
 * materialy, lide, aktivita), a vypíše položky s vyplněným `smazano`,
 * seskupené podle typu. U každé ukáže, kdo a kdy smazal (App.jmenoOsoby).
 * "Obnovit" (právo kos.obnovit) vrátí smazano na null. "Smazat trvale"
 * (právo kos.vysypat, s potvrzením) položku ze souboru trvale odstraní.
 * Nahoře tlačítko "Vysypat celý koš" (kos.vysypat, důrazné potvrzení).
 *
 * Čte App.polozky(<soubor>) (u těchto pěti souborů vždy pole položek —
 * App.data drží VŽDY celou obálku, proto se nikdy nesahá na App.data[soubor]
 * přímo, viz hlavičkový komentář js/app.js), zapisuje přes GH.zmen a po
 * úspěchu uloží celou vrácenou obálku pomocí App.uloz(soubor, obsah).
 * Používá App.potvrd / App.toast / App.prekresli / App.jmenoOsoby přesně
 * podle API v js/app.js.
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

  // ---- tenké obaly nad společnými App.polozky()/App.uloz() (js/app.js) ----

  function polozkyZeSouboru(soubor) {
    return App.polozky(soubor);
  }

  function ulozDoAppData(soubor, obsah) {
    App.uloz(soubor, obsah);
  }

  function smazaneSkupiny() {
    return SEKCE.map(function (s) {
      return {
        soubor: s.soubor,
        nazevTypu: s.nazevTypu,
        nazev: s.nazev,
        polozky: polozkyZeSouboru(s.soubor).filter(function (p) { return !!p.smazano; })
      };
    }).filter(function (s) { return s.polozky.length > 0; });
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
        g.polozky.forEach(function (p) {
          var kdo = p.smazano.kdo ? App.jmenoOsoby(p.smazano.kdo) : "—";
          var kdy = formatKdy(p.smazano.kdy);
          html +=
            '<article class="radek-kos" data-soubor="' + esc(g.soubor) + '" data-id="' + esc(p.id) + '">' +
            '<div class="radek-kos-text">' +
            "<strong>" + esc(g.nazev(p)) + "</strong>" +
            '<span class="radek-kos-meta">smazal(a) ' + esc(kdo) + " · " + esc(kdy) + "</span>" +
            "</div>" +
            '<div class="radek-kos-akce">' +
            (smiObnovit ? '<button type="button" class="btn btn-mala btn-sekundarni" data-akce="obnovit" data-soubor="' + esc(g.soubor) + '" data-id="' + esc(p.id) + '">Obnovit</button>' : "") +
            (smiVysypat ? '<button type="button" class="btn btn-mala btn-nebezpecny" data-akce="vysypat" data-soubor="' + esc(g.soubor) + '" data-id="' + esc(p.id) + '">Smazat trvale</button>' : "") +
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
      if (akce === "obnovit") obnovitPolozku(btn.dataset.soubor, btn.dataset.id);
      else if (akce === "vysypat") smazatTrvale(btn.dataset.soubor, btn.dataset.id);
      else if (akce === "vysypat-vse") vysypatVse();
    });
  }

  function najdiPopisek(soubor, id) {
    var s = SEKCE.find(function (x) { return x.soubor === soubor; });
    var p = polozkyZeSouboru(soubor).find(function (x) { return x.id === id; });
    return p && s ? s.nazev(p) : id;
  }

  function obnovitPolozku(soubor, id) {
    var popisek = najdiPopisek(soubor, id);
    GH.zmen(
      soubor,
      function (polozky) {
        var p = polozky.find(function (x) { return x.id === id; });
        if (p) p.smazano = null;
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

  function smazatTrvale(soubor, id) {
    var popisek = najdiPopisek(soubor, id);
    App.potvrd('Opravdu trvale smazat „' + popisek + '“? Tuto akci nelze vrátit zpět.').then(function (ano) {
      if (!ano) return;
      GH.zmen(
        soubor,
        function (polozky) {
          var idx = polozky.findIndex(function (x) { return x.id === id; });
          if (idx !== -1) polozky.splice(idx, 1);
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

  function vysypatVse() {
    var skupiny = smazaneSkupiny();
    var celkem = skupiny.reduce(function (soucet, g) { return soucet + g.polozky.length; }, 0);
    if (!celkem) return;

    App.potvrd("Opravdu trvale smazat VŠECH " + celkem + " položek v koši ze všech kategorií? Tuto akci nelze vrátit zpět.").then(function (ano) {
      if (!ano) return;

      var chyby = [];
      var retez = Promise.resolve();
      skupiny.forEach(function (g) {
        retez = retez
          .then(function () {
            return GH.zmen(
              g.soubor,
              function (polozky) {
                for (var i = polozky.length - 1; i >= 0; i--) {
                  if (polozky[i].smazano) polozky.splice(i, 1);
                }
              },
              "Vysypán koš — " + g.nazevTypu
            );
          })
          .then(function (obsah) {
            ulozDoAppData(g.soubor, obsah);
          })
          .catch(function (chyba) {
            chyby.push(g.nazevTypu + ": " + ((chyba && chyba.hlaska) || "chyba"));
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
