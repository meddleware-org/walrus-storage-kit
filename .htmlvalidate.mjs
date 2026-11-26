// html-validate configuration (`npm run lint:html`): the fleet's shared rules from `@meddleware/frontend-config`, applied to the `<template>` of every `.vue` file under src/.
// Nothing is overridden here: a rule that fails is fixed in the markup, not switched off.
import { htmlValidateConfig } from '@meddleware/frontend-config/html-validate'

export default htmlValidateConfig()
