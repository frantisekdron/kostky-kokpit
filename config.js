/* Konfigurace kokpitu "Pragerovy kostky" (Emauzy II).
   Tvar viz config.priklad.js. osoby[].blob = {salt, iv, ct} (vse base64)
   je zasifrovany JSON {jmeno, role, osoba_id, token} heslem dane osoby -
   PBKDF2-SHA256/600000 iteraci + AES-GCM-256. Bez hesla se z bloku nic
   neprecte. Generuje a meni VYHRADNE `scripts/nastav_pristup.py`
   (bez prepinacu / --rotace / --pridej) - needituj rucne.
   Tenhle soubor SE MUSI verzovat (viz .gitignore) - appka bez nej nema
   zadny pristupovy token a nenaskoci. */
var KONFIG = {
  "repo": "frantisekdron/kostky-data",
  "vetev": "main",
  "osoby": [
    {
      "id": "honza",
      "jmeno": "Jan Goldšmíd",
      "blob": {
        "salt": "+VTNBc8fQT4YpKcauOBk+A==",
        "iv": "CQ23fs1nmk+9Bqen",
        "ct": "8vsW4iiwbdMHgF38xMXmU++6zFEsVffjAxSN2bAAJ7DII6nhZw/uUF2uMyjN8b241QhPcJ7WOr+S/OLIUAXqdlpMoyPr1wmZ51apufQxioikNK9vZ81QsF7BiI0mGTaqS6bx85ltXwhlsqqDto56QOo12ni8a/obUgKY8Y5NlAxFZNLWv+FlVd7iadlLwRoVzRXQaQqGexSF2UeMWbNtgVpFGm+N+9jwxZFogNiUykgXIr3ZOteVe5vObZOQ9hhp"
      }
    },
    {
      "id": "lucie",
      "jmeno": "Lucie Obdržálková",
      "blob": {
        "salt": "7GBN/5NtTRTxURp9tEB5Sg==",
        "iv": "M9CNaM5lZhjreCfr",
        "ct": "xzFS8WU66X+qeyKg6DjsK/xdrqfOazOJZhxgPGgynCIVrdgkENtoJr/Yhl6UmqYxQbPHG9OoqBjXO7HplTtOISAckrQ83y4Xg3FuwxgV9HrUbn7qreYMKsrYRaIJ05xevXSCl1ynDwmX64wp8lstyLKSo9XSA23bwtFTftc0zmFJq25G+uZ5UUMimOyjSHJGE9KbKW17rZ36TZ9qdK9sp6j2RSVZOsCfnTzLlEHgMV67vR03oLNB1742MTTfbVmgPA=="
      }
    },
    {
      "id": "veronika",
      "jmeno": "Veronika Hanzelková",
      "blob": {
        "salt": "lMl6/HQwHZ2vJEOT6tbVmA==",
        "iv": "nipouFM0uNRkdrcu",
        "ct": "LsUW8o8muinOr77vBv2V14MV6m3jhVz++wYD9nBWcDb48EtuQGw8/FpnN8fio/Pql1MCp/xR8klHFnHpV5fp/H9RPcfvaiXrl/o4HbYeAZSkr5p3gIX0GZGSGv/Gk9amnf/ojd+ZluMdWr17EMfGWhm5kJrSdfQCXZkvCj38zVTJJXSxnhtU41nWdZtHMfk8Pzed33+csO8kZxUJH5p/g4Wee012EzdMuOz5vnvJOSRA5yZB4vLK267zrYBJOb/O7PU="
      }
    },
    {
      "id": "tomas",
      "jmeno": "Tomáš Fuksa",
      "blob": {
        "salt": "WcCO65uHiku3oHj2LcaehQ==",
        "iv": "5TZEszbQ5Q8Z/0W6",
        "ct": "AUpCdSTJ5npc29lgYAlezqh9vi31WXnlWf3aL9TQSSJdtKgViQq51pfWgoMvQ2yj8jbdE51KrKAtb+3wPlD4IFKQLlDqlpbWh3mFWEYL3rNMkpVLxeLkpuaQVM/3PX9wbeqz+xF7dwLt4X7LqLL5Q2cNpgn8GnxicxbB8TO0RnaGLapFrQpCxFg/p8YqWA177AoZi8AcN+p8/bERjL58BLtm53vbqskBNsh0a3qDPAmxMUwPmi1Qml7O0g=="
      }
    },
    {
      "id": "jakub",
      "jmeno": "Jakub Hudek",
      "blob": {
        "salt": "sgl96UeGx/kEdJ4+nxRjZw==",
        "iv": "y/rlKqHyaAEKTnFP",
        "ct": "G5Wf1UiNsxVB++tn5U2WdoNTLC6QKCHlgxtNiU4Cee0jh/wgyHW3mwsIVwzLuCtydxJNsMBBelzlwyAvwOpBXCnFvBmRyqBZPukSxDm04KcgwLJTQEg4fvXvO7uKETrhK1p3ci5sBGgSxbHnExG4T3HmbjaH7Rq9P+ZcP15QnU539ccUPxp/f4sPdW4XoP5vDJXkecXLKfGGngo4o2IaACfL7raK4c31gbOHt8+RQmMAZlSIHlPaHQ0="
      }
    },
    {
      "id": "ondrej",
      "jmeno": "Ondřej Šimek",
      "blob": {
        "salt": "zSbjpQrwPR2EKtORac4Pnw==",
        "iv": "rYsBbI0yNKtkOYtr",
        "ct": "5ABiBmAu1L2jA7e4mYCbkBzNAxlAVTwULCuf7Ax+Gmf+m+TZseiLodGiN5CFCo9/mY3LLF7U60czO+8Y2ipzIsSFZJ+7oUQJ4LsIgFuOijFb4xkNospiEG2HoG3zPhaKDAuDU+axBopGgf2rrbqGuk9kz5oudm1ROtoKZgRKGu66yP8a7L46u5TxQIHYbEAa/QgvWWFSeLBoL5XOQt4RESTd9fm+JyqScW3sT49oC0T/RymS9P/VbutvmLk="
      }
    },
    {
      "id": "michal",
      "jmeno": "Michal Růžička",
      "blob": {
        "salt": "TsapRa5ypwcRZKCTuOxJHQ==",
        "iv": "COey/hh+W6BxUygq",
        "ct": "L1uJSqKhasn5IBE+nQFLbxhgTcQLxHBDvp2nEGycihktjVrOoacjDnBQJEwD951CUQIgoDXatz5dvHgTgNLHotAPMCZKvC2zPTVrZ7I5uuugraMgdYalfWM0nJPMI5Lf/5oKkNPHFzaopCUGqwwSHLmYm1wxV3DuhlNobB6egnfgm0QR4ThJtXypaxJsG9NuV2YOZgGcKEcERHXKlkNeF2+O18CtRQfGd4zWs/lrHHIWDUfKzYWtfApN847k2z4="
      }
    }
  ]
};
