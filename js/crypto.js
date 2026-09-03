/**
 * crypto.js — kryptograficke jadro kokpitu "Pragerovy kostky".
 *
 * Vystavuje globalni objekt Krypto:
 *   Krypto.odvodKlic(heslo, saltBase64) -> Promise<CryptoKey>
 *       Odvodi AES-GCM 256 klic z hesla pres PBKDF2-SHA256 (600 000 iteraci).
 *   Krypto.desifruj(blob, heslo) -> Promise<object|null>
 *       blob = { salt, iv, ct } (vse base64). Pri spatnem hesle nebo poskozenem
 *       blobu vraci null a NIKDY nevyhazuje vyjimku ven.
 *   Krypto.zasifruj(objekt, heslo) -> Promise<{ salt, iv, ct }>
 *       Zasifruje objekt novym nahodnym saltem (16 B) a IV (12 B).
 *   Krypto.otisk(text) -> Promise<string>
 *       SHA-256 hex otisk prvnich 16 znaku vstupu (pouziva se pro kontrolu
 *       podle §7 kontraktu — detekce zmeny sifrovaneho blobu v config.js).
 *   Krypto.b64Encode(buffer) / Krypto.b64Decode(base64)
 *       Pomocne prevody ArrayBuffer <-> base64 (bez zavislosti na UTF-8 textu).
 *
 * Vse pocitano pres window.crypto.subtle (Web Crypto API). Zadne zavislosti,
 * zadne knihovny. ES2020, jeden globalni <script>.
 */

var Krypto = (function () {
  "use strict";

  var PBKDF2_ITERACI = 600000;
  var DELKA_KLICE_BITU = 256;
  var DELKA_SALT_BAJTU = 16;
  var DELKA_IV_BAJTU = 12;

  // ---- pomocne prevody ArrayBuffer/Uint8Array <-> base64 ----

  function bufferNaBase64(buffer) {
    var bajty = new Uint8Array(buffer);
    var binarniRetezec = "";
    for (var i = 0; i < bajty.length; i++) {
      binarniRetezec += String.fromCharCode(bajty[i]);
    }
    return btoa(binarniRetezec);
  }

  function base64NaBuffer(base64) {
    var ocisteneBase64 = String(base64).replace(/\s+/g, "");
    var binarniRetezec = atob(ocisteneBase64);
    var bajty = new Uint8Array(binarniRetezec.length);
    for (var i = 0; i < binarniRetezec.length; i++) {
      bajty[i] = binarniRetezec.charCodeAt(i);
    }
    return bajty.buffer;
  }

  // ---- odvozeni AES-GCM 256 klice z hesla pres PBKDF2-SHA256 ----

  function odvodKlic(heslo, saltBase64) {
    var kodovani = new TextEncoder();
    var saltBuffer = base64NaBuffer(saltBase64);
    return window.crypto.subtle
      .importKey("raw", kodovani.encode(heslo), { name: "PBKDF2" }, false, ["deriveKey"])
      .then(function (zakladniKlic) {
        return window.crypto.subtle.deriveKey(
          {
            name: "PBKDF2",
            salt: saltBuffer,
            iterations: PBKDF2_ITERACI,
            hash: "SHA-256"
          },
          zakladniKlic,
          { name: "AES-GCM", length: DELKA_KLICE_BITU },
          false,
          ["encrypt", "decrypt"]
        );
      });
  }

  // ---- desifrovani blobu { salt, iv, ct } danym heslem ----
  // Pri spatnem hesle / poskozenych datech vraci null, nikdy nevyhazuje ven.

  function desifruj(blob, heslo) {
    if (!blob || !blob.salt || !blob.iv || !blob.ct) {
      return Promise.resolve(null);
    }
    // POZOR: odvodKlic() dekoduje salt SYNCHRONNE, takze pri nevalidnim
    // base64 hodilo atob vyjimku JESTE PRED vznikem promisy — .catch nize
    // se na ni nechytil a utekla ven. Slib „nikdy nevyhazuje ven“ tim padal
    // a volajici zustal viset (zamek sekce Naklady zamrzl na „Odemykam…“).
    // Proto se cely zacatek zabaluje do promisy.
    return Promise.resolve()
      .then(function () { return odvodKlic(heslo, blob.salt); })
      .then(function (klic) {
        var ivBuffer = base64NaBuffer(blob.iv);
        var ctBuffer = base64NaBuffer(blob.ct);
        return window.crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBuffer }, klic, ctBuffer);
      })
      .then(function (otevrenyBuffer) {
        var dekodovani = new TextDecoder();
        var jsonText = dekodovani.decode(otevrenyBuffer);
        try {
          return JSON.parse(jsonText);
        } catch (chybaParsovani) {
          return null;
        }
      })
      .catch(function () {
        // spatne heslo (selze overeni GCM tagu) nebo poskozeny blob -> null
        return null;
      });
  }

  // ---- sifrovani objektu heslem, novy nahodny salt + iv pri kazdem volani ----

  function zasifruj(objekt, heslo) {
    var saltBajty = window.crypto.getRandomValues(new Uint8Array(DELKA_SALT_BAJTU));
    var ivBajty = window.crypto.getRandomValues(new Uint8Array(DELKA_IV_BAJTU));
    var saltBase64 = bufferNaBase64(saltBajty.buffer);
    return odvodKlic(heslo, saltBase64).then(function (klic) {
      var kodovani = new TextEncoder();
      var otevrenyBuffer = kodovani.encode(JSON.stringify(objekt));
      return window.crypto.subtle
        .encrypt({ name: "AES-GCM", iv: ivBajty }, klic, otevrenyBuffer)
        .then(function (sifrovanyBuffer) {
          return {
            salt: saltBase64,
            iv: bufferNaBase64(ivBajty.buffer),
            ct: bufferNaBase64(sifrovanyBuffer)
          };
        });
    });
  }

  // ---- SHA-256 hex otisk prvnich 16 znaku vstupu ----

  function otisk(text) {
    var vstup = String(text || "").slice(0, 16);
    var kodovani = new TextEncoder();
    return window.crypto.subtle.digest("SHA-256", kodovani.encode(vstup)).then(function (hashBuffer) {
      var bajty = new Uint8Array(hashBuffer);
      var hex = "";
      for (var i = 0; i < bajty.length; i++) {
        var castHex = bajty[i].toString(16);
        hex += castHex.length === 1 ? "0" + castHex : castHex;
      }
      return hex;
    });
  }

  return {
    odvodKlic: odvodKlic,
    desifruj: desifruj,
    zasifruj: zasifruj,
    otisk: otisk,
    b64Encode: bufferNaBase64,
    b64Decode: base64NaBuffer
  };
})();
