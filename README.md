# FTR iOS app — setup guide

Two parts, both in this folder:

| Folder | What it is |
|---|---|
| `server/` | Your existing WhatsApp bot (ftr-update-19) **plus** a customer API for the app at `/api/v1`. Deploy it the same way you deploy the bot today. |
| `ios/` | The iPhone app (SwiftUI, iOS 17+). Open `ios/FTR.xcodeproj` in Xcode. |

## How it fits together

```
iPhone app ──HTTPS──▶ your FTR server (/api/v1) ──▶ orders.json ──▶ Google Sheet "Orders" tab
                                │                         customers.json ──▶ "Customers" tab
                                └──▶ Chef's WhatsApp: Approve / Edit price / Decline (same as today)
```

The app never talks to Google directly, so your Google service-account key stays on the server.
An app order is the same as a WhatsApp order: same menu and chef dates from `/admin`, same prices,
half trays, minimums, LIVE Dose travel fees and slots, same Sheet row, same approval buttons, same
Zelle deposit flow. The only difference is that the chef's prompt says **"New app order needs approval … via the FTR app"**.

Customers get every update (approved, Zelle details, payment confirmed, quotes) in the app's
**Messages** tab, plus a push notification once push is set up. A WhatsApp copy is only sent if they
messaged you on WhatsApp in the last 24 hours. WhatsApp-only customers see no change.

## 1. Update the server

Copy these files over your live bot, then restart it (`npm start` / your service):

- **Changed:** `src/server.js`, `src/messaging.js`, `src/orderFlow.js`, `src/payments.js`, `src/vonageClient.js`, `src/adminAuth.js`, `public/admin.html`
- **New:** `src/appApi.js`, `src/appUsers.js`, `src/appInbox.js`, `src/appCarts.js`, `src/phoneVerify.js`, `src/push.js`

No new npm packages are needed. Add to `.env`:

```ini
# Sign-in codes (Vonage Verify, same Vonage app as the bot).
# Codes go on WhatsApp from your WHATSAPP_FROM_NUMBER, with a text message 2 minutes later
# if the WhatsApp code isn't used. Customers can also tap "Text me a code instead".
# Turn on Verify for your Vonage account; if WhatsApp isn't enabled for Verify yet,
# the server automatically sends a text instead.
APP_OTP_MODE=vonage            # use "log" only for testing: the code is printed in the server log
APP_OTP_WHATSAPP=on            # "off" = text messages only
APP_OTP_BRAND=FTR              # name shown in the text: "Your FTR code is 123456"

# A fixed login for Apple's App Review team (no text message is sent for this number)
APP_DEMO_PHONE=2015550123      # pick any number that is not a real customer
APP_DEMO_CODE=482913

# Optional
APP_SUPPORT_EMAIL=franklintiffinroom@gmail.com
APP_INSTAGRAM=ftr.doseadda
APP_MIN_VERSION=1.0            # raise later to force old app versions to update

# Push notifications (from Apple Developer > Keys) - optional; the app works without them
APNS_KEY_PATH=/path/to/AuthKey_XXXXXXXXXX.p8
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=XXXXXXXXXX
APNS_BUNDLE_ID=com.franklintiffinroom.app
```

Check it's live: open `https://<your-bot-address>/api/v1/config` in a browser. You should see your
business name and settings as JSON.

### Staying in sync with your admin page
The app has no menu or settings of its own. It reads them from your bot server, the same
data the WhatsApp bot uses and the admin page edits: dishes, prices, descriptions, the
required question on a dish, open dates, and every Setup switch and value (pickup only, half
trays and their price, minimums, max trays, pickup times, delivery miles, Zelle deposit and
the Zelle details, the phone number). It checks for changes when it opens, when the cart
opens, and every 2 minutes while it's in use, so a save in the admin page shows on
customers' phones within a couple of minutes, the same as on WhatsApp.

### Chef's Kitchen (the admin page inside the app)
When the phone signed in to the app is your owner WhatsApp number (`OWNER_WHATSAPP_NUMBER`,
plus any numbers in `APP_ADMIN_PHONES=...` for helpers), the Account tab shows **Chef's
Kitchen**. It opens your real admin page inside the app, already signed in - no password.
It's the same page as on the web, so menu, calendar, Setup, orders and customers are always
in sync with WhatsApp. The admin page now also has **Approve / Decline**, **Payment
received / Not received** and **Send quote** buttons on waiting orders (they do exactly what
the WhatsApp buttons do). Edit price stays on WhatsApp.

## 2. Build the app

### No Mac? Build in the cloud (GitHub Actions)
`.github/workflows/ios.yml` builds the app on a cloud Mac.
1. Put this folder in a **private** GitHub repo. Every push to `ios/` compiles the app (no Apple account needed).
2. In App Store Connect: **Users and Access ▸ Integrations ▸ App Store Connect API ▸ +** (role: App Manager). Download the `.p8` key (you can only download it once).
3. In the repo: **Settings ▸ Secrets and variables ▸ Actions**, add `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_P8` (paste the whole .p8 text).
4. **Actions ▸ iOS ▸ Run workflow**. About 15 minutes later the build shows in App Store Connect ▸ TestFlight.

### With a Mac
1. On a Mac, install Xcode 16 or newer and open `ios/FTR.xcodeproj`.
2. Select the **FTR** target, open **Signing & Capabilities**, and choose your Team. If the bundle id
   `com.franklintiffinroom.app` is taken, change it, and change `APNS_BUNDLE_ID` to match.
3. If your bot isn't at `https://bot.franklintiffinroom.com`, open **Build Settings** and change
   `FTR_API_BASE_URL`. It must end in `/api/v1`.
4. Press Run to try it in the simulator or on your iPhone.
5. To publish: **Product ▸ Archive ▸ Distribute App ▸ App Store Connect**. Then use TestFlight for
   friends and family before you submit for review.

## 3. App Store submission checklist

- **Privacy policy URL** (required). It must cover your phone number, name, address, order history
  and payment screenshots. These are used only to take orders.
- **App Review notes:** give them `APP_DEMO_PHONE` / `APP_DEMO_CODE`. Explain that orders are approved
  by the chef, and that payment is a Zelle deposit outside the app for catering, which is a physical
  service, so no in-app purchase applies.
- Screenshots for a 6.9" iPhone.
- Category: Food & Drink.
- Account deletion is built in (Account ▸ Delete my account), as Apple requires.

## What's in the app

- **Menu:** browse without signing in. It shows the chef's open dates, dishes with sizes, servings
  and full/half tray prices, search, and the LIVE Dose Station planner (plate total, MD/OD split, notes).
- **Checkout:** for catering, the pickup agreement (or delivery, if you turn pickup-only off). For
  LIVE Dose, the event address is checked on the map, showing the distance and travel fee, and the
  customer can ask Chef for an exception if it's out of range. Then date chips and time slots
  (pickup AM/PM, delivery windows, or LIVE Dose crew arrival with the full schedule), and a priced
  review from the server.
- **Orders:** progress shown as a tiffin carrier. The Zelle deposit card has copy buttons, your QR
  code and the deadline, and customers upload the screenshot in the app. It goes to the chef with the
  same Payment received / Not received buttons. Customers can also accept or decline quotes and
  re-order.
- **Notifications:** every update from the kitchen, labelled (Approved, Declined, Deposit due, Payment confirmed, Released, Quote ready…) with filters for approvals and payments.
- **Saved cart:** the cart is kept with the customer's account, so they can leave and pick it up later on any phone; there's also a Save for later button.
- **Select several dishes** from the menu at once and set their quantities on one screen.
- **Your admin switches** (pickup only, half trays, Zelle deposit, each date's Lunch/Dinner/Delivery/LIVE Dose, a dish's required question) show in the app; it re-reads them whenever it's opened.
- **Account:** name, custom quote request, ask a question, call Chef, sign out, delete account.

## Testing locally without texts or WhatsApp

```bash
cd server
APP_OTP_MODE=log npm start      # sign-in codes appear in the terminal
```
Then point the app at `http://<your-mac-ip>:3000/api/v1` (Build Settings ▸ `FTR_API_BASE_URL`). For
plain http you'd also need an App Transport Security exception, so the simplest approach is to test
against the real https address.
