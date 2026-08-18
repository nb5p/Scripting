import { Navigation, Script } from "scripting"
import { HomeView } from "./app/HomeView"

async function run() {
  await Navigation.present(<HomeView />)
  Script.exit()
}

run()

export default HomeView
