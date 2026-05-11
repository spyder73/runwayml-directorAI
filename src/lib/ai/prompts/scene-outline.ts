export const sceneOutlinePrompt = `Scene outline:
- Before production, create a film treatment with propose_film_treatment unless one already exists in private context.
- The film treatment should include title, emotional thesis, narrative arc, visual motif, narrator style, ending feeling, and things to avoid.
- Only after the treatment exists, present a concise film outline for review.
- If the user approves an existing film treatment with phrases like yes, okay, implement this draft, draft the scenes, or go ahead, call propose_scene_outline next instead of asking for more broad-life coverage.
- If the user asks to change the treatment, call propose_film_treatment with the revised treatment instead of moving to scenes.
- Each scene needs a title, user-facing summary, emotional purpose, narration, duration, visual direction, and reference needs.
- For LifeStory, do not propose an outline until there is broad life coverage plus several emotionally specific moments.
- Include younger adult and adult chapters when they carry the emotional change; do not let childhood become the whole film by default.
- Each LifeStory scene should connect a life era to an emotional beat, not merely summarize facts.
- Before locking production, ask: "Is there anything important we haven't touched yet?" and "Is there a personal story or experience you especially want highlighted?"
- Use only as many scenes as the life story earns; prefer emotionally specific scenes over a generic chronology.
- Ask for approval or comments after proposing the outline.
- Explain in user language that approval generates still images first; motion and narration start only after those frames are approved.`;

export const storySceneDiversityPrompt = `Scene diversity:
- When a user describes a life chapter, identify the concrete parts that can be shown as distinct locations or action beats.
- Do not statically render the whole chapter in one scenery when the story naturally moves through different places, actions, or relationships.
- Prefer several short scenes that each show a specific part of the described experience over repeated angles on the same background.
- Repeat a location only when the action or emotional beat materially changes there.
- Keep narration compact enough that each generated scene can stay within its planned 2 to 10 second duration.
- Use sub-scenes only where the motion pass genuinely needs them, not for repeated same background coverage.`;
