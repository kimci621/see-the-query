import '../../../src/index.css';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SandboxProvider, useSandbox } from '../../../src/features/db/SandboxProvider';
import { SplitScene } from '../../../src/features/lessons/mdx/SplitScene';

function Fixture() {
  const { sandbox } = useSandbox();
  useEffect(() => {
    if (sandbox) void sandbox.loadLesson('empty', []);
  }, [sandbox]);
  return (
    <>
      <button
        type="button"
        onClick={() =>
          sandbox?.apply(
            "create table student (id int primary key, name text, hobbies text); insert into student values (1, 'Анна', 'шахматы, рисование'), (2, 'Борис', 'плавание'), (3, 'Вера', 'музыка, кино, шахматы');",
          )
        }
      >
        Создать данные
      </button>
      <button
        type="button"
        onClick={() => sandbox?.apply("update student set hobbies = 'плавание, бег' where id = 2")}
      >
        Изменить данные
      </button>
      <button type="button" onClick={() => sandbox?.apply('alter table student drop column hobbies')}>
        Удалить колонку
      </button>
      <SplitScene
        source="student"
        keyColumn="id"
        extract="hobbies"
        target="student_hobby"
        parentColumn="student_id"
        valueColumn="hobby"
      />
    </>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Нет элемента для сцены');
createRoot(root).render(
  <SandboxProvider>
    <main className="mx-auto max-w-5xl px-4">
      <Fixture />
    </main>
  </SandboxProvider>,
);
