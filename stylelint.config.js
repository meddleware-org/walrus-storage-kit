// Stylelint configuration (`npm run lint:css`): the fleet's shared one for CSS and the `<style>` blocks of Vue files: design tokens only for colour and layering,
// no hex colours, accessibility rules and browser-support linting. Nothing is overridden here.
import { stylelintConfig } from '@meddleware/frontend-config/stylelint'

export default stylelintConfig()
