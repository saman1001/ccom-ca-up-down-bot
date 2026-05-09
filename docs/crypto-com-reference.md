# Crypto.com Exchange Reference

This project was implemented against the official Crypto.com Exchange REST API documentation and the public Crypto.com agent trading skill.

Useful links:

- https://exchange-docs.crypto.com/exchange/v1/rest-ws/index.html
- https://github.com/crypto-com/crypto-agent-trading/tree/main/crypto-com-exchange
- https://github.com/crypto-com/cdcx-cli

Important implementation notes:

- Private REST endpoints use `POST`.
- Public REST endpoints use `GET`.
- Private requests include `id`, `method`, `api_key`, `params`, `nonce`, and `sig`.
- Signature payload is `method + id + api_key + sorted_parameter_string + nonce`.
- HMAC-SHA256 is computed with the API secret and encoded as lowercase hex.
- Order numeric fields such as `price`, `quantity`, and `notional` should be sent as strings.
- API keys should not allow withdrawals for this bot.
