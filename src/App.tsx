import { useState, useCallback } from "react";
import { openXmlFile, exportData, type ParsedData, type SortKey } from "./backend";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";


function SortableColumnItem({
  id,
  enabled,
  onToggle,
}: {
  id: string;
  enabled: boolean;
  onToggle: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="column-item">
      <span className="drag-handle" {...attributes} {...listeners}>
        ⠿
      </span>
      <input
        type="checkbox"
        checked={enabled}
        onChange={() => onToggle(id)}
        id={`col-${id}`}
      />
      <label htmlFor={`col-${id}`}>{id}</label>
    </div>
  );
}

export default function App() {
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [enabledColumns, setEnabledColumns] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<SortKey[]>([]);
  const [exportType, setExportType] = useState<"flex" | "excel">("flex");
  const [outputText, setOutputText] = useState<string>("");
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleOpenFile = useCallback(async () => {
    setIsLoading(true);
    setStatus(null);
    try {
      const data = await openXmlFile();
      setParsedData(data);
      setColumnOrder(data.columns);
      setEnabledColumns(new Set(data.columns));
      setSortConfig([]);
      setStatus({
        text: `Loaded ${data.rows.length} rows with ${data.columns.length} columns: ${data.columns.join(", ")}`,
        ok: true,
      });
    } catch (err) {
      const msg = String(err);
      if (msg !== "No file selected") {
        setStatus({ text: `Error: ${msg}`, ok: false });
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setColumnOrder((cols) => {
        const oldIndex = cols.indexOf(active.id as string);
        const newIndex = cols.indexOf(over.id as string);
        return arrayMove(cols, oldIndex, newIndex);
      });
    }
  }, []);

  const toggleColumn = useCallback((col: string) => {
    setEnabledColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  }, []);

  const addSortKey = useCallback(() => {
    if (!parsedData) return;
    setSortConfig((prev) => [
      ...prev,
      { column: parsedData.columns[0], direction: "asc" },
    ]);
  }, [parsedData]);

  const removeSortKey = useCallback((index: number) => {
    setSortConfig((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateSortKey = useCallback(
    (index: number, field: keyof SortKey, value: string) => {
      setSortConfig((prev) =>
        prev.map((key, i) => (i === index ? { ...key, [field]: value } : key))
      );
    },
    []
  );

  const handleExport = useCallback(async () => {
    if (!parsedData) return;
    setIsLoading(true);
    setStatus(null);
    try {
      const activeColumns = columnOrder.filter((c) => enabledColumns.has(c));
      const result = await exportData(
        parsedData.rows,
        activeColumns,
        sortConfig,
        exportType
      );
      setOutputText(result.text);
      setStatus({ text: result.summary, ok: true });
    } catch (err) {
      const msg = String(err);
      if (msg !== "No save location selected") {
        setStatus({ text: `Error: ${msg}`, ok: false });
      }
    } finally {
      setIsLoading(false);
    }
  }, [parsedData, columnOrder, enabledColumns, sortConfig, exportType]);

  return (
    <div className="app">
      <header>
        <h1>Dekereke IL Text Export</h1>
      </header>

      <section className="section">
        <div className="row-gap">
          <button onClick={handleOpenFile} disabled={isLoading} className="btn-primary">
            Open XML File
          </button>
          {parsedData && (
            <span className="muted">{parsedData.rows.length} rows loaded</span>
          )}
        </div>
      </section>

      {parsedData && (
        <>
          <section className="section">
            <h2>
              Columns{" "}
              <span className="hint">drag to reorder · check to include in export</span>
            </h2>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={columnOrder} strategy={verticalListSortingStrategy}>
                <div className="column-list">
                  {columnOrder.map((col) => (
                    <SortableColumnItem
                      key={col}
                      id={col}
                      enabled={enabledColumns.has(col)}
                      onToggle={toggleColumn}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </section>

          <section className="section">
            <h2>Sort rows</h2>
            <div className="sort-config">
              {sortConfig.map((key, index) => (
                <div key={index} className="sort-row">
                  <span className="sort-label">
                    {index === 0 ? "Sort by" : "then by"}
                  </span>
                  <select
                    value={key.column}
                    onChange={(e) => updateSortKey(index, "column", e.target.value)}
                  >
                    {parsedData.columns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                  <select
                    value={key.direction}
                    onChange={(e) => updateSortKey(index, "direction", e.target.value)}
                  >
                    <option value="asc">A → Z</option>
                    <option value="desc">Z → A</option>
                  </select>
                  <button onClick={() => removeSortKey(index)} className="btn-remove">
                    ×
                  </button>
                </div>
              ))}
              <button onClick={addSortKey} className="btn-secondary">
                + Add sort key
              </button>
            </div>
          </section>

          <section className="section">
            <h2>Export format</h2>
            <div className="radio-group">
              <label>
                <input
                  type="radio"
                  name="exportType"
                  value="flex"
                  checked={exportType === "flex"}
                  onChange={() => setExportType("flex")}
                />
                <span>
                  <strong>FLEx Baseline text</strong>
                  <span className="hint"> — one cell per line, no separators</span>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="exportType"
                  value="excel"
                  checked={exportType === "excel"}
                  onChange={() => setExportType("excel")}
                />
                <span>
                  <strong>Excel tab-separated</strong>
                  <span className="hint"> — spaces→tabs, blank line between entries</span>
                </span>
              </label>
            </div>
          </section>

          <section className="section">
            <button
              onClick={handleExport}
              disabled={isLoading || enabledColumns.size === 0}
              className="btn-primary btn-export"
            >
              Generate output
            </button>
          </section>
        </>
      )}

      {status && (
        <div className={`status ${status.ok ? "status-ok" : "status-error"}`}>
          {status.text}
        </div>
      )}

      {outputText && (
        <section className="section output-section">
          <div className="output-header">
            <h2>Output</h2>
            <button
              className="btn-secondary"
              onClick={() => {
                navigator.clipboard.writeText(outputText);
              }}
            >
              Copy all
            </button>
          </div>
          <textarea
            className="output-textarea"
            readOnly
            value={outputText}
            spellCheck={false}
          />
        </section>
      )}
    </div>
  );
}
