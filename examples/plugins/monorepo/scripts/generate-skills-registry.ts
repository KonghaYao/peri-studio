#!/usr/bin/env bun
/** 将 OpenSpec Skill 目录受限收集为可随 Worker bundle 部署的静态 registry。 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
    buildStaticSkillResources,
    renderStaticSkillResourcesModule,
} from "@peri-code/mcpp/skills/build";

const skillsDir = resolve(import.meta.dir, "..", "openspec", "skills");
const output = resolve(import.meta.dir, "..", "openspec", "static-skills.generated.ts");
const resources = await buildStaticSkillResources(skillsDir);
await writeFile(output, renderStaticSkillResourcesModule(resources));
console.log(`Generated ${resources.length} static Skill resources: ${output}`);
