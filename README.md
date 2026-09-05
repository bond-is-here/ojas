# Ojas

Ojas is a personal health intelligence platform for bringing the signals that matter into one place.

The name comes from Sanskrit **ojas** (ओजस्), commonly associated with vitality, energy, and inner strength.

## Vision

Ojas is designed to help people build a clearer, more complete picture of their health by connecting:

- Nutrition and calorie tracking
- Fitness and daily activity
- Wearables such as WHOOP and Apple Watch
- Medical reports and health records
- Optional personal AI models and assistants

AI is an extension of Ojas—not a requirement. The core experience should remain useful, understandable, and personal without requiring users to bring their own model.

## Principles

- **Personal by default:** Your health picture should reflect your goals, routines, and context.
- **Connected, not fragmented:** Bring activity, nutrition, wearable, and medical information together.
- **AI-optional:** Add intelligence when it helps, while keeping the product useful on its own.
- **Clear over complicated:** Turn health data into practical understanding and actionable insights.
- **Privacy-minded:** Health information deserves careful handling and transparent user control.

## Project status

The working website lives in [`web/`](web/README.md). Its minimal dashboard brings together a Three.js vitality halo and four daily essentials: movement, sleep, nourishment, and hydration. Detailed charts, editable goals, a journal, and a breathing timer are available when needed.

Connections supports Apple Health export imports and OAuth integrations for WHOOP and Oura. WHOOP and Oura require developer-app credentials and account authorization before live sync. Imported daily totals and connection settings are saved per signed-in account; manual entries remain in the current browser. Medical records and AI integrations remain part of the longer-term vision.

To run it locally with Node.js 22.13+ and pnpm:

```sh
cd web
pnpm install
cp .dev.vars.example .dev.vars
# Set a random 64-character hexadecimal encryption key in .dev.vars.
pnpm db:local
pnpm dev
```

## License

Ojas is available under the [MIT License](LICENSE).
