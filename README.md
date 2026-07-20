# r1Keyfolio

Клиентский пакетный сканер ключей и адресов по нескольким блокчейнам.

Вставляешь список `hex` / `WIF` / адресов / passphrase — в браузере локально
деривуются адреса, затем проверяются балансы. Приватные ключи на сервер
не уходят: наружу отправляются только адреса.

## Возможности

- Ввод построчно или загрузка `.txt` / `.csv` пачками
- Вход: приватный ключ `hex` (64), `WIF`, готовый адрес, brainwallet-фраза
- Режимы **NORMAL** / **BRAIN** / **BOTH**
- Четыре BTC-адреса из одного ключа:
  compressed, uncompressed, P2SH-P2WPKH (script), native SegWit (`bc1`)
- Сети: BTC, LTC, DOGE, DASH, ZEC, ETH / BSC / Polygon / Arbitrum /
  Optimism / Base / Avalanche, TRON
- Фильтры funded / alive / empty / err, поиск, экспорт CSV
- В карточке brainwallet показывается полученный private key

## Режимы ввода

| Режим | Поведение |
|-------|-----------|
| **NORMAL** | строка = hex / WIF / адрес |
| **BRAIN** | строка = passphrase → `SHA256(UTF-8)` → private key |
| **BOTH** | для каждой строки создаются обе версии и проверяются обе |

Пример для **BRAIN** / **BOTH**:

```
correct horse battery staple
my secret phrase
password
```

Строки с `#` / `//` и пустые пропускаются.

> Brainwallet слабый: простые фразы перебираются. Только для проверки
> своих старых passphrase.

## Проверка балансов

### UTXO (батчами)

| Сеть | API |
|------|-----|
| **BTC** | [blockchain.info](https://blockchain.info) `/balance?active=a\|b\|…` → fallback [Blockchair](https://blockchair.com) |
| **LTC / DOGE / DASH / ZEC** | Blockchair `POST /{chain}/addresses/balances` |

- BTC: до 40 адресов за запрос, ответ с `final_balance`, `total_received`, `n_tx`
- Остальные UTXO: mass check, стоимость ≈ `1 + 0.001 × адресов`
- Троттлинг, чтобы не ловить `429` / `402`

**Лимиты Blockchair (free):**

| | |
|--|--|
| В сутки | ~1440 request points |
| В минуту | 30 запросов |
| Сброс | **00:00 UTC** |

### EVM / TRON

Публичные RPC (PublicNode и др.) и TronGrid — по адресу.

## Стек

React + TypeScript + Vite · `@noble/*` / `@scure/*` · `ethers`

## Быстрый старт

```bash
npm install
npm run dev
```

Dev: `http://localhost:5173` (прокси Vite `/x/...` без CORS).

### Docker

```bash
docker compose up --build -d
```

Prod: `http://localhost:8085` — nginx раздаёт статику и проксирует API.

### Сборка

```bash
npm run build
```

## Ответственное использование

Только для проверки **своих** ключей и адресов.

## Лицензия

[MIT](./LICENSE)
