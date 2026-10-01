import { exercisesFor, nextExercise } from './curriculum';

describe('workplace curriculum', () => {
  it('contains a complete 30-exercise path for each launch target', () => {
    for (const variety of ['en-US', 'en-GB'] as const) {
      const exercises = exercisesFor(variety);
      expect(exercises).toHaveLength(30);
      expect(new Set(exercises.map((exercise) => exercise.id)).size).toBe(30);
      expect(exercises.filter((exercise) => exercise.category === 'meetings')).toHaveLength(20);
      expect(exercises.filter((exercise) => exercise.category === 'interviews')).toHaveLength(10);
    }
  });

  it('recommends the first unfinished exercise', () => {
    const exercises = exercisesFor('en-US');
    expect(nextExercise('en-US', [exercises[0].id]).id).toBe(exercises[1].id);
  });
});
