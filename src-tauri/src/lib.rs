use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct ParsedData {
    pub columns: Vec<String>,
    pub rows: Vec<HashMap<String, String>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SortKey {
    pub column: String,
    pub direction: String,
}

/// Reads a file that may be UTF-16 LE (with or without BOM), UTF-16 BE, or UTF-8.
/// Dekereke XML files are typically UTF-16 LE with a BOM (FF FE).
fn read_dekereke_file(path: &std::path::Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;

    // UTF-16 LE BOM: FF FE
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        let data = &bytes[2..];
        if data.len() % 2 != 0 {
            return Err("Odd byte count after UTF-16 LE BOM".to_string());
        }
        let u16s: Vec<u16> = data
            .chunks_exact(2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .collect();
        return String::from_utf16(&u16s).map_err(|e| e.to_string());
    }

    // UTF-16 BE BOM: FE FF
    if bytes.len() >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF {
        let data = &bytes[2..];
        if data.len() % 2 != 0 {
            return Err("Odd byte count after UTF-16 BE BOM".to_string());
        }
        let u16s: Vec<u16> = data
            .chunks_exact(2)
            .map(|b| u16::from_be_bytes([b[0], b[1]]))
            .collect();
        return String::from_utf16(&u16s).map_err(|e| e.to_string());
    }

    // UTF-8 BOM (EF BB BF) or plain UTF-8
    let start = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) { 3 } else { 0 };
    String::from_utf8(bytes[start..].to_vec()).map_err(|e| e.to_string())
}

/// Parses a Dekereke XML string.
/// Root element: <phon_data>, row elements: <data_form>.
/// Scans ALL rows to discover every column (empty cells may be absent in some rows).
fn parse_dekereke(xml: &str) -> Result<ParsedData, String> {
    let doc = roxmltree::Document::parse(xml).map_err(|e| e.to_string())?;
    let root = doc.root_element();

    let mut all_columns: Vec<String> = Vec::new();
    let mut rows: Vec<HashMap<String, String>> = Vec::new();

    for row_node in root.children().filter(|n| n.is_element()) {
        let mut row: HashMap<String, String> = HashMap::new();

        for cell_node in row_node.children().filter(|n| n.is_element()) {
            let tag = cell_node.tag_name().name().to_string();
            if !all_columns.contains(&tag) {
                all_columns.push(tag.clone());
            }
            let text = cell_node.text().unwrap_or("").trim().to_string();
            if !text.is_empty() {
                row.insert(tag, text);
            }
        }

        rows.push(row);
    }

    Ok(ParsedData {
        columns: all_columns,
        rows,
    })
}

#[tauri::command]
async fn open_xml_file(app: tauri::AppHandle) -> Result<ParsedData, String> {
    use tauri_plugin_dialog::DialogExt;

    let file_path = app
        .dialog()
        .file()
        .add_filter("Dekereke XML", &["xml"])
        .blocking_pick_file();

    let path = match file_path {
        Some(p) => p.into_path().map_err(|e| e.to_string())?,
        None => return Err("No file selected".to_string()),
    };

    let text = read_dekereke_file(&path)?;
    parse_dekereke(&text)
}

#[tauri::command]
async fn export_data(
    app: tauri::AppHandle,
    rows: Vec<HashMap<String, String>>,
    column_order: Vec<String>,
    sort_config: Vec<SortKey>,
    export_type: String,
) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;

    // Stable multi-key sort
    let mut sorted_rows = rows;
    sorted_rows.sort_by(|a, b| {
        for key in &sort_config {
            let av = a.get(&key.column).map(|s| s.as_str()).unwrap_or("");
            let bv = b.get(&key.column).map(|s| s.as_str()).unwrap_or("");
            let cmp = av.cmp(bv);
            if cmp != std::cmp::Ordering::Equal {
                return if key.direction == "desc" { cmp.reverse() } else { cmp };
            }
        }
        std::cmp::Ordering::Equal
    });

    let mut output = String::new();

    for row in &sorted_rows {
        for col in &column_order {
            if let Some(text) = row.get(col) {
                let text = text.trim();
                if !text.is_empty() {
                    if export_type == "flex" {
                        // FLEx Baseline: each cell content on its own line
                        output.push_str(text);
                        output.push('\n');
                    } else {
                        // Excel tab-separated: spaces become tabs, blank line after each entry
                        // so each entry can be triple-clicked and pasted as tab-delimited cells
                        let tabbed = text.replace(' ', "\t");
                        output.push_str(&tabbed);
                        output.push('\n');
                        output.push('\n');
                    }
                }
            }
        }
    }

    let save_path = app
        .dialog()
        .file()
        .add_filter("Text file", &["txt"])
        .blocking_save_file();

    let path = match save_path {
        Some(p) => p.into_path().map_err(|e| e.to_string())?,
        None => return Err("No save location selected".to_string()),
    };

    std::fs::write(&path, output.as_bytes()).map_err(|e| e.to_string())?;

    Ok(format!(
        "Exported {} rows to {}",
        sorted_rows.len(),
        path.display()
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_xml_file, export_data])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
