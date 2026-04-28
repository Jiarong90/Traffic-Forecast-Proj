# FAST Frontend CSS Layout

Runtime CSS is loaded from `frontend/index.html` using the recommended structure:

- `base.css`: root variables and global browser reset/base styles
- `layout.css`: page shell, navigation, home/about/profile/settings layout blocks
- `components.css`: reusable cards, admin tables, dashboard/admin components
- `pages-dashboard.css`: dashboard/map feedback legacy block kept in load order for visual stability
- `pages-map.css`: route planner panel styles kept in load order for visual stability
- `pages-route.css`: weather panel styles kept in load order for visual stability
- `pages-weather.css`: alerts, habit routes, chatbot related UI kept in load order for visual stability
- `pages-alerts.css`: expressway analytics, incident ML, journey HUD and admin tools
- `modals.css`: mobile and final override styles, including modal sizing overrides

The filenames now match the recommended structure. Some large legacy style blocks still contain multiple page sections and can be further refined safely later.
