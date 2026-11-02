export function ComingSoon({ title, day }: { title: string; day: number }) {
  return (
    <div className="grid min-h-[50vh] place-items-center text-center">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-gray-500">Coming on Day {day}.</p>
      </div>
    </div>
  );
}
