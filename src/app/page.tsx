import TaskManager from "./task-manager";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <TaskManager />
    </main>
  );
}
