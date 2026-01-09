export default function TestButton() {
  return (
    <div className="flex flex-col items-center gap-4 p-6 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold text-white">
        React + Tailwind Test Component
      </h2>
      <p className="text-white/90">
        This is a <span className="font-semibold">static</span> React component
        with Tailwind styling
      </p>
      <div className="px-6 py-3 bg-white text-purple-600 font-semibold rounded-md shadow-md">
        Static Badge
      </div>
    </div>
  );
}
