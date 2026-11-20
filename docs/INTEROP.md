# Open standards and interoperability: walrus-storage-kit

The Walrus upload widgets (relay choice, tip estimate, pass-gated upload).

This page lists what the project speaks today, what is planned, what was considered and does not apply, where someone else can extend it, and what proves each claim. The platform-wide list is [Standards we use](https://meddleware.dev/platform/standards). A row appears there in the same change that turns a standard on.

## Spoken today

- Wallet Standard (connects any compatible wallet, through @meddleware/wallet-adapter)
- The relay's documented HTTP interface; a relay is chosen at run time

## Planned

- RFC 9457 problem details for relay and gateway errors

## Considered, not applicable

- none

## Extension points

- Any compatible upload relay can be selected

## What proves it

- its unit tests
- the gallery's five-browser e2e

_Maintained centrally with the platform's interoperability map; changes go through it so every repository says the same thing._
