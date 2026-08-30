/**
 * auth.js — prihlaseni, role a matice opravneni kokpitu "Pragerovy kostky".
 *
 * Cte globalni KONFIG z config.js (viz config.priklad.js pro presny tvar):
 *   KONFIG = { repo, vetev, osoby: [ { id, jmeno, blob:{salt,iv,ct} }, ... ] }
 * Desifrovany blob ma tvar { jmeno, role, osoba_id, token }.
 *
 * Vystavuje globalni objekt Auth:
 *   Auth.seznamOsob()             -> [{id, jmeno}]  pro <select> na loginu
 *   Auth.prihlas(id, heslo)       -> Promise<{ok:true} | {ok:false, chyba:string}>
 *   Auth.odhlas(duvod)            -> vymaze pamet i localStorage, prenacte stranku
 *   Auth.jePisar()                -> boolean, ma zapisovy token (role != "ctenar")
 *   Auth.nactiPrava(pristupyData) -> doplni matici prav z pristupy.json, zkontroluje aktivitu
 *   Auth.can(kod)                 -> boolean
 *   Auth.ja                       -> {id, jmeno, role, osoba_id} | null  (jen ctecka vlastnost)
 *   Auth.role                     -> "superadmin"|"admin"|"editor"|"ctenar"|null (jen ctecka)
 *   Auth.roleZTokenu              -> role zamcena v desifrovanem blobu pri prihlaseni,
 *                                     NEMENNA po celou dobu session (jen ctecka). Urcuje
 *                                     realnou kryptografickou uroven tokenu (§1.1 kontraktu):
 *                                     "ctenar" = TOKEN_READ, cokoli jineho = TOKEN_WRITE.
 *                                     `nactiPrava()` podle ni hlida, aby role dosazena
 *                                     pozdeji z pristupy.json nemohla clovka POVYSIT nad
 *                                     uroven, na kterou ma fyzicky token (viz dole).
 *   Auth.token                    -> GitHub token drzeny JEN v pameti, nikdy v localStorage
 *
 * DEMO REZIM (dodatek §E): kdyz je window.DEMO === true, Auth funguje i BEZ config.js -
 * pri prvnim dotazu na identitu (Auth.ja / Auth.role / can() / jePisar() / prihlasDemo())
 * se sam "prihlasi" fiktivni osoba (prevzata z DEMO_DATA, jinak "František Dron ·
 * super admin" podle dodatku §E), token zustava null a nic se nikam neposila.
 *   Auth.jeDemo()                 -> boolean, bezi appka v demo rezimu?
 *   Auth.prihlasDemo()            -> {ok:true} - vynuti demo prihlaseni (jinak lazy)
 *   Auth.nastavDemoRoli(role)     -> boolean, prepne roli demo uzivatele (demo prepinac
 *                                     roli); mimo demo rezim nedela nic a vrati false
 * V demo rezimu `nactiPrava()` roli z pristupy.json ZAMERNE nepresazuje (jinak by
 * prvni polling/nacteni dat prepnutou demo roli hned prepsalo zpatky) a neodhlasuje
 * pri `aktivni: false`; matice prav se nacita normalne, aby can() sedelo na roli.
 *
 * Token se nikdy neuklada do localStorage. Po obnoveni stranky je pamet prazdna
 * a je nutne se prihlasit znovu heslem (session drzi token jen v pameti - §7).
 *
 * OPRAVA (dodatek, vysoka zavaznost): `pristupy.json` je organizacni soubor, ktery
 * muze prepsat kdokoli s pravem `prava.upravit`. Puvodni `nactiPrava()` z nej roli
 * prevzalo bez kontroly, takze cloveku s cist-only tokenem sel v pristupy.json
 * nastavit napr. "admin" a appka mu ukazala cele editacni UI, ktere by pri kazdem
 * zapisu spadlo na 403 (token na to fyzicky nema pravo). `nactiPrava()` proto
 * roli z pristupy.json povoluje jen v ramci stejne urovne, na jake je token
 * zamceny v `Auth.roleZTokenu` (viz telo funkce nize a §D.3/§1.1 dodatku):
 *   - roleZTokenu === "ctenar"    -> z pristupy.json smi projit jen "ctenar"
 *   - roleZTokenu !== "ctenar"    -> z pristupy.json smi projit "editor"/"admin"/
 *                                     "superadmin" (zapisujici role) NEBO "ctenar"
 *                                     (organizacni omezeni zapisujiciho na cteni -
 *                                     mene prav je vzdy v poradku, GH.init se pritom
 *                                     znovu nevola - token zustava zapisujici, jen
 *                                     UI/`can()` se chova jako ctenar)
 * Neplatna/mimo-uroven hodnota se ignoruje (role zustane na posledni platne hodnote,
 * na startu tedy na `roleZTokenu`) a jednou (ne na kazdy polling) se vypise
 * console.warn, at je to videt v konzoli, ale nezaplavi ji.
 */

var Auth = (function () {
  "use strict";

  var KLIC_LOCALSTORAGE = "kostky_login";

  var ja = null; // {id, jmeno, role, osoba_id}
  var role = null;
  var roleZTokenu = null; // NEMENNA po prihlaseni - realna uroven tokenu (viz hlavickovy komentar)
  var token = null;
  var maticePrav = {}; // role -> {kod_prava: bool}
  var maticeNactena = false;
  var varovaniPovyseniVypsano = false; // aby console.warn pri povyseni role nespamoval na kazdy polling
  var demoRoleNastavena = null; // rucne prepnuta role v demo rezimu (Auth.nastavDemoRoli)

  var ZNAME_ROLE = { superadmin: true, admin: true, editor: true, ctenar: true };

  // ---- DEMO REZIM (dodatek §E) ----------------------------------------------
  // Zaloha identity, kdyz neni k dispozici DEMO_DATA: dodatek §E rika doslova
  // "prihlas fiktivniho František Dron · super admin".

  var DEMO_ZALOHA = {
    id: "franta",
    jmeno: "František Dron",
    role: "superadmin",
    osoba_id: "os-07"
  };

  function jeDemo() {
    return typeof window !== "undefined" && window.DEMO === true;
  }

  // Fiktivni osoba pro demo. Primarne se bere z DEMO_DATA (at sedi na aktualni
  // seed data i po zmenach v lide.json/pristupy.json), jinak z DEMO_ZALOHA.
  function zjistiDemoOsobu() {
    var osoba = {
      id: DEMO_ZALOHA.id,
      jmeno: DEMO_ZALOHA.jmeno,
      role: DEMO_ZALOHA.role,
      osoba_id: DEMO_ZALOHA.osoba_id
    };
    var data = typeof DEMO_DATA !== "undefined" ? DEMO_DATA : null;
    if (!data) {
      return osoba;
    }
    // 1) prvni aktivni superadmin z pristupy.json
    var pristupy = data.pristupy && data.pristupy.data ? data.pristupy.data : data.pristupy;
    var uzivatele = (pristupy && pristupy.uzivatele) || null;
    if (uzivatele) {
      var klice = Object.keys(uzivatele);
      for (var i = 0; i < klice.length; i++) {
        var zaznamUzivatele = uzivatele[klice[i]];
        if (zaznamUzivatele && zaznamUzivatele.role === "superadmin" && zaznamUzivatele.aktivni !== false) {
          if (klice[i] !== osoba.id) {
            osoba.id = klice[i];
            osoba.jmeno = klice[i]; // nahradi se nize jmenem z lide.json, kdyz se najde
            osoba.osoba_id = null;
          }
          break;
        }
      }
    }
    // 2) jmeno a osoba_id z lide.json podle ma_pristup
    var lide = data.lide && Array.isArray(data.lide.polozky) ? data.lide.polozky : [];
    for (var j = 0; j < lide.length; j++) {
      if (lide[j] && lide[j].ma_pristup === osoba.id && !lide[j].smazano) {
        osoba.jmeno = lide[j].jmeno || osoba.jmeno;
        osoba.osoba_id = lide[j].id || osoba.osoba_id;
        break;
      }
    }
    return osoba;
  }

  // V demu neni zadny token - GH stejne nikam nesaha, ale at je jeho vnitrni
  // "smim zapisovat" v souladu s prave nastavenou demo roli.
  function srovnejGHSRoli(aktualniRole) {
    if (typeof GH === "undefined" || !GH || typeof GH.init !== "function") {
      return;
    }
    GH.init({ token: null, jeZapis: aktualniRole !== "ctenar" });
  }

  // Lazy demo prihlaseni - vola se z getteru i z can()/jePisar(), takze staci
  // nastavit window.DEMO = true kdykoli pred prvnim pouzitim Auth.
  function zajistiDemoPrihlaseni() {
    if (!jeDemo() || ja) {
      return false;
    }
    var osoba = zjistiDemoOsobu();
    var pouzitaRole = demoRoleNastavena || osoba.role || "superadmin";
    ja = { id: osoba.id, jmeno: osoba.jmeno, role: pouzitaRole, osoba_id: osoba.osoba_id };
    role = pouzitaRole;
    roleZTokenu = pouzitaRole; // v demu zadny token neni - uroven = prave nastavena role
    token = null;
    varovaniPovyseniVypsano = false;
    srovnejGHSRoli(pouzitaRole);
    return true;
  }

  // Demo prepinac roli. Mimo demo rezim zamerne nedela NIC (aby se pres nej
  // nedala obejit kryptograficka hranice ctenar/zapisovatel z §1.1 kontraktu).
  function nastavDemoRoli(novaRole) {
    if (!jeDemo()) {
      console.warn("Auth.nastavDemoRoli funguje jen v demo režimu (window.DEMO === true).");
      return false;
    }
    if (!Object.prototype.hasOwnProperty.call(ZNAME_ROLE, novaRole)) {
      console.warn("Auth.nastavDemoRoli: neznámá role '" + novaRole + "'.");
      return false;
    }
    demoRoleNastavena = novaRole;
    if (!ja) {
      zajistiDemoPrihlaseni();
    }
    ja.role = novaRole;
    role = novaRole;
    roleZTokenu = novaRole;

    // Přepnout i IDENTITU, ne jen roli. Bez toho zůstane přihlášený pořád
    // pořád tentýž člověk ze strany FD, takže App.jsemZaFD() vrací true i „jako čtenář"
    // a interní obchodní čísla se ukazují ve všech rolích. V demu se tím
    // nedá nic obejít — v ostrém provozu tahle funkce vůbec nic nedělá.
    // Jméno ani ID nikoho tady natvrdo nemáme — appka je ve VEŘEJNÉM repu.
    // Vezmeme prvního člověka, který má v datech tuhle roli přidělenou.
    var kdo = null;
    try {
      var pristupy = (window.App && App.obsah) ? App.obsah("pristupy") : null;
      var uziv = (pristupy && pristupy.uzivatele) || {};
      var hledanyId = null;
      for (var uid in uziv) {
        if (Object.prototype.hasOwnProperty.call(uziv, uid) &&
            uziv[uid] && uziv[uid].role === novaRole && uziv[uid].aktivni !== false) {
          hledanyId = uid;
          break;
        }
      }
      if (hledanyId && window.App && App.polozky) {
        App.polozky("lide").forEach(function (o) {
          if (!kdo && !o.smazano && o.ma_pristup === hledanyId) kdo = o;
        });
      }
    } catch (e) { kdo = null; }

    if (kdo) {
      ja.osoba_id = kdo.id;
      ja.jmeno = kdo.jmeno;
      ja.id = kdo.ma_pristup;
    }

    srovnejGHSRoli(novaRole);
    return true;
  }

  function prihlasDemo() {
    zajistiDemoPrihlaseni();
    return { ok: true };
  }

  // ---- pomocne: najit osobu v KONFIG podle id ----

  function najdiOsobu(id) {
    if (typeof KONFIG === "undefined" || !KONFIG || !Array.isArray(KONFIG.osoby)) {
      return null;
    }
    for (var i = 0; i < KONFIG.osoby.length; i++) {
      if (KONFIG.osoby[i].id === id) {
        return KONFIG.osoby[i];
      }
    }
    return null;
  }

  // ---- seznam osob pro vyber na loginu (aktivitu resi az pristupy.json) ----

  function seznamOsob() {
    if (jeDemo()) {
      var demoOsoba = zjistiDemoOsobu();
      return [{ id: demoOsoba.id, jmeno: demoOsoba.jmeno }];
    }
    if (typeof KONFIG === "undefined" || !KONFIG || !Array.isArray(KONFIG.osoby)) {
      return [];
    }
    return KONFIG.osoby.map(function (osoba) {
      return { id: osoba.id, jmeno: osoba.jmeno };
    });
  }

  // ---- localStorage: ulozeni / odstraneni zapamatovaneho prihlaseni ----

  function odstranUlozenePrihlaseni() {
    try {
      window.localStorage.removeItem(KLIC_LOCALSTORAGE);
    } catch (chyba) {
      // localStorage nedostupny (soukromy rezim apod.) - neni co delat
    }
  }

  function ulozPrihlaseni(id, otiskBlobu) {
    try {
      window.localStorage.setItem(KLIC_LOCALSTORAGE, JSON.stringify({ id: id, otisk: otiskBlobu }));
    } catch (chyba) {
      // localStorage nedostupny - proste nebude "zapamatovane", nic se nerozbije
    }
  }

  // ---- kontrola ulozeneho prihlaseni proti aktualnimu config.js (past ze §7) ----
  // Otisk = Krypto.otisk(prvnich 16 znaku sifrovaneho blob.ct dane osoby).
  // Po rotaci tokenu (novy config.js) se blob.ct zmeni -> otisk uz nesedi ->
  // ulozene prihlaseni se zahodi, at prohlizec navzdy nezustava na starem tokenu.
  // Bezi automaticky hned pri nacteni tohoto souboru (pred prvnim vykreslenim loginu).

  function zkontrolujUlozenyOtisk() {
    var surova;
    try {
      surova = window.localStorage.getItem(KLIC_LOCALSTORAGE);
    } catch (chyba) {
      return Promise.resolve();
    }
    if (!surova) {
      return Promise.resolve();
    }
    var ulozeneUdaje;
    try {
      ulozeneUdaje = JSON.parse(surova);
    } catch (chybaParsovani) {
      odstranUlozenePrihlaseni();
      return Promise.resolve();
    }
    var osoba = najdiOsobu(ulozeneUdaje.id);
    if (!osoba || !osoba.blob || !osoba.blob.ct) {
      odstranUlozenePrihlaseni();
      return Promise.resolve();
    }
    return Krypto.otisk(osoba.blob.ct.slice(0, 16))
      .then(function (aktualniOtisk) {
        if (aktualniOtisk !== ulozeneUdaje.otisk) {
          odstranUlozenePrihlaseni();
        }
      })
      .catch(function () {
        odstranUlozenePrihlaseni();
      });
  }

  // spusteno hned pri nacteni skriptu; vystaveno i jako Auth._startovniKontrola,
  // kdyby na ni app.js chtel pockat (napr. pred predvyplnenim vyberu osoby)
  var startovniKontrola = zkontrolujUlozenyOtisk();

  // ---- prihlaseni ----

  function prihlas(id, heslo) {
    if (jeDemo()) {
      // v demu zadny config.js ani heslo neresime - rovnou fiktivni osoba (§E)
      zajistiDemoPrihlaseni();
      return Promise.resolve({ ok: true });
    }
    var osoba = najdiOsobu(id);
    if (!osoba || !osoba.blob) {
      return Promise.resolve({ ok: false, chyba: "Neznámá osoba." });
    }
    return Krypto.desifruj(osoba.blob, heslo)
      .then(function (obsah) {
        if (!obsah || !obsah.role || !obsah.token) {
          return { ok: false, chyba: "Nesprávné heslo." };
        }
        ja = {
          id: id,
          jmeno: obsah.jmeno || osoba.jmeno,
          role: obsah.role,
          osoba_id: obsah.osoba_id || null
        };
        role = obsah.role;
        roleZTokenu = obsah.role; // zamknout uroven tokenu - uz se po zbytek session nemeni
        token = obsah.token;
        varovaniPovyseniVypsano = false; // nove prihlaseni - varovani o povyseni role zase muze padnout
        return Krypto.otisk(osoba.blob.ct.slice(0, 16)).then(function (otiskBlobu) {
          ulozPrihlaseni(id, otiskBlobu);
          return { ok: true };
        });
      })
      .catch(function () {
        return { ok: false, chyba: "Přihlášení se nezdařilo." };
      });
  }

  // ---- odhlaseni: vymaze pamet i localStorage a prenacte stranku ----

  function odhlas(duvod) {
    ja = null;
    role = null;
    roleZTokenu = null;
    token = null;
    maticePrav = {};
    maticeNactena = false;
    varovaniPovyseniVypsano = false;
    demoRoleNastavena = null;
    odstranUlozenePrihlaseni();
    if (duvod) {
      try {
        window.alert(duvod);
      } catch (chybaAlert) {
        // bez dialogu proste rovnou pokracujeme na reload
      }
    }
    window.location.reload();
  }

  // ---- ma prihlaseny clovek zapisovy token? (role != "ctenar") ----

  function jePisar() {
    zajistiDemoPrihlaseni();
    return role !== null && role !== "ctenar";
  }

  // ---- ktera role z pristupy.json smi projit vzhledem k urovni tokenu (oprava povyseni) ----
  // Vraci povolenou roli, nebo null kdyz je navrzena role nad uroven tokenu (zamitnuto).

  var ZAPISUJICI_ROLE = { editor: true, admin: true, superadmin: true };

  function povolRoliPodleTokenu(navrzenaRole) {
    if (roleZTokenu === "ctenar") {
      // cist-only token: jedina povolena role je "ctenar" samotny
      return navrzenaRole === "ctenar" ? "ctenar" : null;
    }
    // zapisujici token (editor/admin/superadmin - vsechny maji TOKEN_WRITE, §1.1):
    // "ctenar" z pristupy.json je organizacni OMEZENI zapisujiciho - mene prav je
    // vzdy v poradku, jen se pritom NEVOLA znovu GH.init (token zustava zapisujici)
    if (navrzenaRole === "ctenar") {
      return "ctenar";
    }
    if (Object.prototype.hasOwnProperty.call(ZAPISUJICI_ROLE, navrzenaRole)) {
      return navrzenaRole;
    }
    return null;
  }

  // ---- doplneni matice prav a kontrola aktivity po nacteni pristupy.json ----
  // Prijima obsah pristupy.json - bud cely obal { verze, ..., data:{role,uzivatele} }
  // nebo primo vnitrni { role, uzivatele } - obojí je zpracovano spravne.

  function nactiPrava(pristupyData) {
    var obsah = pristupyData && pristupyData.data ? pristupyData.data : pristupyData;
    maticePrav = obsah && obsah.role ? obsah.role : {};
    maticeNactena = true;

    var uzivatele = obsah && obsah.uzivatele ? obsah.uzivatele : {};
    if (jeDemo()) {
      // demo: roli drzi rucni prepinac (Auth.nastavDemoRoli), pristupy.json ji
      // nesmi prepsat zpatky; ani "aktivni: false" tu nesmi odhlasit (odhlas()
      // prenacita stranku a demo by se zacyklilo pri kazdem nacteni dat)
      zajistiDemoPrihlaseni();
      return;
    }
    if (!ja) {
      return;
    }
    var zaznam = uzivatele[ja.id];
    if (!zaznam) {
      return;
    }
    // role je organizacni udaj z pristupy.json - muze se zmenit i bez rotace
    // tokenu (editor/admin/superadmin sdileji stejnou uroven tokenu - §1.1),
    // ALE nikdy nesmi POVYSIT clovka nad uroven, na kterou ma token fyzicky pravo
    // (viz hlavickovy komentar souboru a povolRoliPodleTokenu vyse).
    if (zaznam.role) {
      var povolenaRole = povolRoliPodleTokenu(zaznam.role);
      if (povolenaRole === null) {
        if (!varovaniPovyseniVypsano) {
          console.warn(
            "pristupy.json navrhuje pro '" + ja.id + "' roli '" + zaznam.role +
              "', ale token je zamceny na urovni '" + roleZTokenu +
              "' - ignoruji, ponechavam '" + role + "'."
          );
          varovaniPovyseniVypsano = true;
        }
        // navrzena role se ignoruje - ja.role/role zustavaji na posledni platne hodnote
      } else {
        ja.role = povolenaRole;
        role = povolenaRole;
      }
    }
    if (zaznam.aktivni === false) {
      odhlas("Přístup byl pozastaven.");
    }
  }

  // ---- kontrola konkretniho opravneni ----

  function can(kod) {
    zajistiDemoPrihlaseni();
    if (role === "superadmin") {
      return true; // pojistka - superadmin ma vzdy vse, i kdyby byla matice rozbita
    }
    if (!maticeNactena) {
      return kod === "cist";
    }
    // §3.2: maticePrav[role] = { nazev, popis, prava: { kod_prava: bool } }
    var zaznamRole = maticePrav[role];
    var pravaRole = zaznamRole && zaznamRole.prava ? zaznamRole.prava : null;
    if (!pravaRole) {
      return kod === "cist";
    }
    return pravaRole[kod] === true;
  }

  return {
    seznamOsob: seznamOsob,
    prihlas: prihlas,
    odhlas: odhlas,
    jePisar: jePisar,
    nactiPrava: nactiPrava,
    can: can,
    jeDemo: jeDemo,
    prihlasDemo: prihlasDemo,
    nastavDemoRoli: nastavDemoRoli,
    _startovniKontrola: startovniKontrola,
    get ja() {
      zajistiDemoPrihlaseni();
      return ja;
    },
    get role() {
      zajistiDemoPrihlaseni();
      return role;
    },
    get roleZTokenu() {
      zajistiDemoPrihlaseni();
      return roleZTokenu;
    },
    get token() {
      return token;
    }
  };
})();
