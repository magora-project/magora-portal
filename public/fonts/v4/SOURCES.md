# v4 font sources

The v4 brand fonts (portal v4 plan, Task 9). They load only under `data-brand="v4"`, and the service
worker does not precache them (`**/fonts/v4/**` in `workbox.globIgnores`).

## prodiga-regular.ttf

- Source: Creative Fabrica, download `Prodiga-20732871.zip`, file `PRODIGARegular.ttf`, copied unmodified
  (byte-identical to the copy in the portal design folder, `design/fonts/prodiga-regular.ttf`).
- Licence: Creative Fabrica Subscription License, https://www.creativefabrica.com/subscription-license/#full.
  The file embeds no licence string. David confirmed on 2026-11-23 that the licence allows publishing it
  in a public repository (plan Task 7).
- sha256: `56ac01663c9f09c03e287038069614f2dd9b46a029af80d2aeb0b9eb437b8094`

## epilogue-latin-wght.woff2

- Source: the latin subset of the variable font served for
  https://fonts.googleapis.com/css2?family=Epilogue:wght@300..700, fetched 2026-11-23 from
  https://fonts.gstatic.com/s/epilogue/v20/O4ZRFGj5hxF0EhjimlIksgg4lWmc.woff2, unmodified.
- Licence: SIL Open Font License 1.1, https://openfontlicense.org (Epilogue on Google Fonts:
  https://fonts.google.com/specimen/Epilogue/license).
- sha256: `1e161eac1dc51f5b6c90ab7d7ea0fed7ca6a8c072c2fdbcba3095370cbb7e6a1`
