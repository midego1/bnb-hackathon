import addresses from "@/data/demo-world-addresses.json";
import world from "@/data/demo-world.json";
import { personaOf, type Persona, type World } from "./demoWorld.mts";

/** The fictional demo persona (web/data/demo-world.json) behind a wallet on `chainId`, if it is one. */
export const demoPersona = (chainId: number, address: string | undefined): Persona | undefined =>
  personaOf(world as World, addresses, chainId, address);
