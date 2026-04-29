#!/bin/bash

# ==============================================================================
# Weekly Report Generator (Veteran Mode v2)
# Automates weekly progress reporting from Git commit history across directories.
# ==============================================================================

# Configuration
# Default to this week's Monday on Mac
MONDAY_DATE=$(date -v-mon "+%Y-%m-%d")
SINCE_DATE="${1:-$MONDAY_DATE}"
# If the user provides a number instead of a date for the first argument, treat it as days
if [[ "$1" =~ ^[0-9]+$ ]]; then
    SINCE_DATE=$(date -v-"$1"d "+%Y-%m-%d")
fi

# Try to get user name from git config, otherwise use system user
AUTHOR_NAME=$(git config --global user.name 2>/dev/null)
if [ -z "$AUTHOR_NAME" ]; then
    AUTHOR_NAME=$(git config user.name 2>/dev/null)
fi
if [ -z "$AUTHOR_NAME" ]; then
    AUTHOR_NAME=$USER
fi
AUTHOR="${2:-"$AUTHOR_NAME"}"
TARGET_DIR="${3:-"."}"

REPORT_FILE="Weekly_Report_$(date +%Y%m%d).md"

echo "Generating Markdown Weekly Report for '$AUTHOR' since $SINCE_DATE..."
echo "Scanning directory: $TARGET_DIR"
echo "--------------------------------------------------------"

# Initialize Markdown table header
echo "# 週報 / 工時表 ($(date +%Y-%m-%d))" > "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "| PROJECT NAME | MEMBERS | 本週工作內容/進度 | MON | TUE | WED | THU | FRI |" >> "$REPORT_FILE"
echo "|:---|:---|:---|:---:|:---:|:---:|:---:|:---:|" >> "$REPORT_FILE"

# Calculate days for find optimization (current date - SINCE_DATE) + 2 days buffer for safety
current_ts=$(date +%s)
since_ts=$(date -j -f "%Y-%m-%d" "$SINCE_DATE" +%s)
diff_days=$(( (current_ts - since_ts) / 86400 + 2 ))

# Optimized find: Looking for .git folders specifically (up to 6 levels) that were modified recently.
# This avoids deep-crawling into every single subfolder and is much faster on large disks.
repos=$(find "$TARGET_DIR" -maxdepth 6 -type d \( -name "node_modules" -o -name "dist" -o -name "build" -o -name ".next" -o -name "vendor" -o -name "venv" -o -name ".venv" -o -name "Library" -o -name "Caches" -o -name ".cache" -o -name "Pictures" -o -name "Music" -o -name "Movies" \) -prune -o -type d -name ".git" -mtime "-$diff_days" -print)

count=0

for repo_git in $repos; do
    repo_dir=$(dirname "$repo_git")
    repo_name=$(basename "$repo_dir")
    
    # Extract commit messages and the files changed, plus the date (MM-DD)
    # Note: We now INCLUDE merges to ensure Friday work is captured accurately.
    git_out=$(git -C "$repo_dir" log --since="$SINCE_DATE 00:00:00" --author="$AUTHOR" --name-only --pretty=format:"COMMIT|%s|%ad" --date=format:"%m-%d" 2>/dev/null)
    
    if [ ! -z "$git_out" ]; then
        # Group by module (first 2 directories) and track modification dates using awk
        modules_out=$(echo "$git_out" | awk '
        BEGIN { FS="|" }
        /^COMMIT\|/ {
            curr_id++;
            commit_id[curr_id] = curr_id;
            commit_msg[curr_id] = $2;
            commit_date[curr_id] = $3;
            
            # Default to (Root) to ensure we dont lose the commit (especially merges)
            belongs["(Root)", curr_id] = 1;
            all_modules["(Root)"] = 1;
            next;
        }
        length($0) > 0 {
            n = split($0, parts, "/");
            if (n >= 2) m = parts[1] "/" parts[2];
            else m = "(Root)";
            
            # Map this commit to this module
            belongs[m, curr_id] = 1;
            if (m != "(Root)") has_module[curr_id] = 1;
            all_modules[m] = 1;
        }
        END {
            # 1. Identify primary module for root merging
            has_named = 0;
            primary_m = "";
            for (m in all_modules) {
                if (m != "(Root)") {
                    has_named = 1;
                    if (primary_m == "" || m < primary_m) primary_m = m;
                }
            }
            if (!has_named) primary_m = "(Root)";

            # 2. Merge Root items if necessary
            if (all_modules["(Root)"] && primary_m != "(Root)") {
                for (i=1; i<=curr_id; i++) {
                    if (belongs["(Root)", i] && !has_module[i]) belongs[primary_m, i] = 1;
                }
                all_modules[primary_m] = 1;
            }

            # 3. Aggregate each modules specific content and dates
            for (m in all_modules) {
                if (m == "(Root)" && has_named) continue;

                m_content = "";
                delete d_map;
                delete type_msgs;
                delete type_order;
                type_count = 0;
                
                for (i=1; i<=curr_id; i++) {
                    if (belongs[m, i]) {
                        msg = commit_msg[i];
                        d_map[commit_date[i]] = 1;
                        type = "others"; desc = msg;
                        if (msg ~ /^[a-zA-Z0-9 \(\)\[\]]+[ :]+/) {
                           idx = index(msg, ":");
                           if (idx > 0) { type = substr(msg, 1, idx-1); desc = substr(msg, idx+1); }
                        }
                        gsub(/^[ \t]+|[ \t]+$/, "", type); gsub(/^[ \t]+|[ \t]+$/, "", desc);
                        if (desc != "" && !type_msgs[m, type, desc]) {
                            type_msgs[m, type, desc] = 1;
                            if (!(type in type_order)) type_order[type] = ++type_count;
                            if (full_desc[type] != "") full_desc[type] = full_desc[type] "; " desc;
                            else full_desc[type] = desc;
                        }
                    }
                }
                
                # Format final content and date string for this module
                final_content = "";
                for (t_idx=1; t_idx<=type_count; t_idx++) {
                    for (t in type_order) {
                        if (type_order[t] == t_idx) {
                            line = "<b>" t "</b>: " full_desc[t];
                            if (final_content != "") final_content = final_content "<br>- " line;
                            else final_content = "- " line;
                            delete full_desc[t];
                        }
                    }
                }
                d_count = 0; delete d_list;
                for (d in d_map) d_list[++d_count] = d;
                for (i=1; i<=d_count; i++) {
                    for (j=i+1; j<=d_count; j++) {
                        if (d_list[i] > d_list[j]) { t = d_list[i]; d_list[i] = d_list[j]; d_list[j] = t; }
                    }
                }
                final_dates = "";
                for (i=1; i<=d_count; i++) {
                    fmt = d_list[i]; sub(/-/, "/", fmt); sub(/^0/, "", fmt); sub(/\// "0", "/", fmt);
                    if (final_dates != "") final_dates = final_dates "-" fmt;
                    else final_dates = fmt;
                }
                
                # Store for secondary grouping: Group modules by identical (content, dates)
                # If module is root and we have no other modules, keep it as project root.
                m_display = (m == "(Root)") ? "(Root)" : m;
                group_key = final_content "|||" final_dates;
                if (group_content[group_key] == "") {
                    group_modules[group_key] = m_display;
                    group_content[group_key] = final_content;
                    group_dates[group_key] = final_dates;
                    group_order[++group_total] = group_key;
                } else {
                    group_modules[group_key] = group_modules[group_key] ", " m_display;
                }
            }
            
            # 4. Final output of grouped modules
            for (g=1; g<=group_total; g++) {
                key = group_order[g];
                m_label = group_modules[key];
                if (m_label == "(Root)") m_label = "";
                print m_label "@@@" group_content[key] "@@@" group_dates[key];
            }
        }')
        
        if [ ! -z "$modules_out" ]; then
            # Iterate through each grouped module
            while IFS= read -r line; do
                [ -z "$line" ] && continue
                module_name="${line%%@@@*}"
                rest="${line#*@@@}"
                module_commits="${rest%%@@@*}"
                module_dates="${rest##*@@@}"
                
                # Write Markdown row
                echo "| <b>$repo_name</b><br><i>($module_name)</i><br><i>($module_dates)</i> | $AUTHOR | $module_commits |   |   |   |   |   |" >> "$REPORT_FILE"
            done <<< "$modules_out"
            
            count=$((count + 1))
            echo "Found commits in: $repo_name"
        fi
    fi
done

if [ $count -eq 0 ]; then
    echo "No commits found in the specified period."
    echo "| (No commits) | $AUTHOR | | | | | | |" >> "$REPORT_FILE"
else
    # Append summary rows at the bottom
    echo "| 請假 | | | | | | | |" >> "$REPORT_FILE"
    echo "| 加班 | | | | | | | |" >> "$REPORT_FILE"
    echo "| 合計 | | | | | | | |" >> "$REPORT_FILE"
    
    echo "--------------------------------------------------------"
    echo "Done! Report generated: $REPORT_FILE"
fi
