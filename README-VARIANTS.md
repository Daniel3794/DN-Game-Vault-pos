# Admin (backoffice) – variants update

Replace these 2 files in the backoffice project, keep everything else:
- admin.html
- assets/js/admin.js

(The shop site needs the files from dn-game-vault-variants.zip. Both sites share the same Firestore.)

## What changed
- Product form: new "variants" block (name, price, stock per row). When variants exist the main price/stock
  fields are disabled and filled automatically (lowest price, total stock).
- Products list: shows "from <lowest price>", and one -/+ stock row per variant.
- Dashboard "low stock": counts each variant separately.
- POS sale ("ขาย​ໜ້າຮ້ານ"): every variant is its own option. Stock is deducted from that variant.
- Stock-in: every variant is its own option. Cost price stays per product (weighted average over total stock).
- Cancel / reopen / delete order with restock: restores or deducts the correct variant (uses `vi` saved in each order item).
- Orders and receipts now store `vi` (variant index, null for products without variants).
- Products CSV has an extra column with the variants.

## Firestore data: products/{doc}
    variants: [ { name, price, stock, image? } ]   // optional
    price = lowest variant price, stock = sum of variant stock (kept in sync automatically)

## IMPORTANT: Firestore rules (setup/firestore.rules was not provided)
The public shop now writes `variants` (and `vi` inside order items) in the order transaction.
If the current rules only allow the public to change the `stock` field, orders for variant products
will be rejected with a permission error. The rules must allow the public to update only
`stock` and `variants` on products (and only to lower the numbers), and must allow `vi` in order items.
Send the rules file to review/update it.

## Notes
- Old orders (without `vi`) for a product that later got variants are NOT restocked automatically
  (the system cannot know which variant they were). Adjust those by hand with the -/+ buttons.
- Editing the product while a customer is ordering is safe: stock changes use transactions.

## Variant images
Each variant row has a picker with the product photos: click the photo that matches the variant (click again to clear).
Stored as `imageIndex` (position in the product's `images`), so no extra image data is added to the document.
Removing a product photo automatically fixes the variants that pointed to it.

## Pre-order
Product form: tick "Pre-order when sold out" (+ optional ETA text). Stored as `preorder` (bool) and `preorderEta` (string) on the product.
Orders: items bought as pre-order carry `pre: true` and a "[ສັ່ງຈອງ]" tag in the name; the order has `hasPre: true`
and shows a "ມີສັ່ງຈອງ" badge in the order list. Pre-order items never touch stock, and are skipped when an order is cancelled/restocked.
When the goods arrive, use "Stock-in", then fulfil the pre-order orders by hand.
