(function initializeSplitter(root) {
  function cleanLine(line) {
    return line.replace(/\s+/g, " ").trim();
  }

  function appendText(item, field, text) {
    const separator = field === "세부항목" ? " / " : " ";
    item[field] = item[field] ? `${item[field]}${separator}${text}` : text;
  }

  function splitRequestText(fileName, text) {
    const lines = String(text).split(/\r?\n/).map(cleanLine).filter(Boolean);
    let committee = "";
    let member = "";
    let deadline = "";

    for (const line of lines) {
      const header = line.match(/(.+?위원회)\s+(.+?\s*의원)실\s+자료요구서/);
      if (header) {
        committee = header[1].trim();
        member = header[2].replace(/\s*의원$/, "").trim();
      }
      const date = line.match(/제출기한:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./);
      if (date) {
        deadline = `${date[1]}-${date[2].padStart(2, "0")}-${date[3].padStart(2, "0")}`;
      }
    }

    if (!committee || !member || !deadline) {
      throw new Error(`${fileName}: 위원회·의원·제출기한을 찾지 못했습니다.`);
    }

    const items = [];
    let current = null;
    let activeField = "요구내용";

    for (const line of lines) {
      if (line.startsWith("수신:") || line.startsWith("담당 보좌관:") || line === "끝.") continue;
      const number = line.match(/^(\d+)\.\s*(.*)$/);
      if (number) {
        current = {
          파일명: fileName,
          위원회: committee,
          의원: member,
          제출기한: deadline,
          문항번호: Number(number[1]),
          요구내용: number[2].trim(),
          세부항목: "",
          비고: "",
        };
        items.push(current);
        activeField = "요구내용";
        continue;
      }
      if (!current) continue;
      if (/^[가-힣]\.\s*/.test(line)) {
        activeField = "세부항목";
        appendText(current, activeField, line);
      } else if (line.startsWith("※")) {
        activeField = "비고";
        appendText(current, activeField, line.replace(/^※\s*/, ""));
      } else {
        appendText(current, activeField, line);
      }
    }

    return items;
  }

  root.RequestSplitter = { splitRequestText };
})(globalThis);
