const COLLOCATIONS_DB = {
  "determine": [
    {
      pattern: "Determine + whether/if",
      meaning: "確定是否...",
      example_en: "It is the court's job to determine whether he is innocent.",
      example_zh: "法院的責任是確定他是否無辜。"
    },
    {
      pattern: "be determined to + V",
      meaning: "決心做某事",
      example_en: "She is determined to finish the project on time.",
      example_zh: "她決心按時完成這個專案。"
    },
    {
      pattern: "determine + N",
      meaning: "決定 / 影響 (某事)",
      example_en: "Your attitude will determine your success.",
      example_zh: "你的態度將決定你的成功。"
    }
  ]
};

// Export for use in main app
window.COLLOCATIONS_DB = COLLOCATIONS_DB;
