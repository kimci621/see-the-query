import { describe, expect, it } from 'vitest';
import { inPreview, withDataset } from '../../../tests/helpers/db';
import { loadSplitScene } from './split';

const config = {
  source: 'student',
  keyColumn: 'id',
  extract: 'hobbies',
  target: 'student_hobby',
  parentColumn: 'student_id',
  valueColumn: 'hobby',
};

describe('сцена нормализации', () => {
  it('строит три кадра по реальному разбиению PostgreSQL, не меняя таблицу', async () => {
    await withDataset('empty', async (db) => {
      await db.exec(`
        create table student (id int primary key, name text, hobbies text);
        insert into student values (1, 'Анна', 'шахматы, рисование'), (2, 'Борис', 'плавание'), (3, 'Вера', null);
      `);
      const before = await db.query('select * from student order by id');
      const scene = await inPreview(db, () => loadSplitScene(db, config));
      expect(scene.frames).toHaveLength(3);
      expect(scene.frames[0].right).toBeNull();
      expect(scene.frames[1].right?.rows.map((row) => row.values)).toEqual([
        [1, 'шахматы'],
        [1, 'рисование'],
        [2, 'плавание'],
      ]);
      expect(scene.frames[2].left.columns).toEqual(['id', 'name']);
      expect(scene.frames[2].right?.columns).toEqual(['student_id', 'hobby']);
      expect(scene.frames[2].right?.rows.map((row) => row.values)).toEqual([
        [1, 'шахматы'],
        [1, 'рисование'],
        [2, 'плавание'],
      ]);
      expect(scene.truncatedParents).toBe(false);
      expect(scene.truncatedValues).toBe(false);
      expect((await db.query('select * from student order by id')).rows).toEqual(before.rows);
    });
  });

  it('явно отмечает ограничения выборки и отклоняет опасное имя', async () => {
    await withDataset('empty', async (db) => {
      await db.exec(`
        create table student (id int primary key, hobbies text);
        insert into student select i, 'a,b' from generate_series(1, 16) i;
      `);
      const scene = await inPreview(db, () => loadSplitScene(db, config));
      expect(scene.truncatedParents).toBe(true);
      expect(scene.frames[0].left.rows).toHaveLength(15);
      expect(scene.frames[2].right?.rows).toHaveLength(30);
      await expect(
        loadSplitScene(db, { ...config, source: 'student; drop table student' }),
      ).rejects.toThrow();
      expect((await db.query('select count(*) from student')).rows[0][0]).toBe(16);
    });
  });

  it('сообщает об ограничении количества значений и проверяет ключи', async () => {
    await withDataset('empty', async (db) => {
      await db.exec(`
        create table student (id int, hobbies text);
        insert into student values (1, repeat('х,', 200) || 'последнее');
      `);
      const scene = await inPreview(db, () => loadSplitScene(db, config));
      expect(scene.truncatedValues).toBe(true);
      expect(scene.frames[2].right?.rows).toHaveLength(200);
      await db.query("insert into student values (1, 'другое')");
      await expect(inPreview(db, () => loadSplitScene(db, config))).rejects.toThrow(/уникальный ключ/);
    });
  });
});
