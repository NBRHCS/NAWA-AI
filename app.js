const form = document.querySelector("#generatorForm");
const fileInput = document.querySelector("#fileInput");
const fileStatus = document.querySelector("#fileStatus");
const dropZone = document.querySelector("#dropZone");
const lectureText = document.querySelector("#lectureText");
const resultTitle = document.querySelector("#resultTitle");
const resultOutput = document.querySelector("#resultOutput");
const copyButton = document.querySelector("#copyButton");
const downloadButton = document.querySelector("#downloadButton");
const clearButton = document.querySelector("#clearButton");
const generateButton = document.querySelector("#generateButton");

let currentResult = "";
let selectedFileName = "";
let lastPdfReadFailed = false;

const MIN_WORDS = 35;

const typeLabels = {
  summary: "ملخص المحاضرة",
  questions: "أسئلة متوقعة",
  flashcards: "فلاش كارد",
  plan: "خطة مذاكرة بسيطة",
};

const arabicStopWords = new Set([
  "هذا",
  "هذه",
  "ذلك",
  "تلك",
  "الذي",
  "التي",
  "الذين",
  "على",
  "إلى",
  "الى",
  "في",
  "من",
  "عن",
  "مع",
  "كان",
  "كانت",
  "يكون",
  "تكون",
  "كما",
  "لكن",
  "لذلك",
  "حيث",
  "عند",
  "بعد",
  "قبل",
  "بين",
  "أو",
  "ثم",
  "وقد",
  "لدى",
  "ضمن",
  "كل",
  "غير",
]);

const englishStopWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "about",
  "when",
  "where",
  "which",
  "while",
  "because",
  "there",
  "their",
  "these",
  "those",
  "have",
  "has",
  "are",
  "was",
  "were",
  "can",
  "will",
  "should",
]);

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) {
    lastPdfReadFailed = false;
    fileStatus.textContent = "لم يتم اختيار ملف. اختر ملف PDF للمحاضرة.";
    return;
  }

  selectedFileName = file.name;
  lastPdfReadFailed = false;
  fileStatus.textContent = `تم اختيار: ${file.name}`;

  if (!isPdfFile(file)) {
    selectedFileName = "";
    lectureText.value = "";
    lastPdfReadFailed = true;
    fileStatus.textContent = "الملف المختار ليس PDF. الرجاء رفع ملف محاضرة بصيغة PDF فقط.";
    return;
  }

  fileStatus.textContent = "جاري قراءة ملف PDF...";

  try {
    const pdfText = await tryReadPdf(file);
    if (pdfText) {
      lectureText.value = pdfText;
      fileStatus.textContent = `تمت قراءة PDF وتنظيف النص: ${file.name}`;
    } else {
      lastPdfReadFailed = true;
      lectureText.value = "";
      fileStatus.textContent = "تم فتح ملف PDF، لكن لم أتمكن من استخراج نص واضح منه. قد يكون الملف صوراً ممسوحة ضوئياً.";
    }
  } catch {
    lastPdfReadFailed = true;
    lectureText.value = "";
    fileStatus.textContent = "تعذر قراءة ملف PDF. تأكد أن الملف غير تالف ثم جرّب مرة أخرى.";
  }
});

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  });
});

dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files?.[0];
  if (!file) return;
  fileInput.files = event.dataTransfer.files;
  fileInput.dispatchEvent(new Event("change"));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const outputType = new FormData(form).get("outputType");
  const cleanedText = cleanLectureText(lectureText.value);
  const validationError = validateLectureText(cleanedText);

  if (validationError) {
    showResult("تنبيه", validationError, true);
    return;
  }

  setLoading(true);
  resultTitle.textContent = typeLabels[outputType];
  resultOutput.textContent = "جاري التوليد...";

  await waitForUi();

  try {
    currentResult = generateResult(outputType, cleanedText);
    lectureText.value = cleanedText;
    resultOutput.textContent = currentResult;
    copyButton.disabled = false;
    downloadButton.disabled = false;
  } catch {
    showResult("حدث خطأ", "حدثت مشكلة أثناء توليد النتيجة. حاول تقليل النص أو إعادة المحاولة.", true);
  } finally {
    setLoading(false);
  }
});

copyButton.addEventListener("click", async () => {
  if (!currentResult) return;
  await navigator.clipboard.writeText(currentResult);
  copyButton.textContent = "تم النسخ";
  window.setTimeout(() => {
    copyButton.textContent = "نسخ";
  }, 1400);
});

downloadButton.addEventListener("click", () => {
  if (!currentResult) return;
  const blob = new Blob([currentResult], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "nawa-ai-result.txt";
  link.click();
  URL.revokeObjectURL(url);
});

clearButton.addEventListener("click", () => {
  form.reset();
  currentResult = "";
  selectedFileName = "";
  lastPdfReadFailed = false;
  fileStatus.textContent = "أو اسحب الملف هنا. يمكن أيضاً استخدام نص المحاضرة بالأسفل.";
  resultTitle.textContent = "جاهز للتوليد";
  resultOutput.textContent = "ارفع ملفاً أو ألصق نص المحاضرة، اختر نوع المخرجات، ثم اضغط توليد.";
  copyButton.disabled = true;
  downloadButton.disabled = true;
  setLoading(false);
});

async function tryReadPdf(file) {
  const pdfjsLib = window.pdfjsLib;

  if (!pdfjsLib) {
    throw new Error("PDF.js is not loaded");
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => item.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (pageText) pages.push(pageText);
  }

  return cleanLectureText(pages.join("\n\n"));
}

function isPdfFile(file) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function cleanLectureText(text) {
  if (!text) return "";

  const normalized = text
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/-\s*\n\s*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const rawLines = normalized
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const counts = rawLines.reduce((map, line) => {
    const key = normalizeLineKey(line);
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map());

  const cleanedLines = rawLines.filter((line) => {
    const key = normalizeLineKey(line);
    if (isCopyrightLine(line)) return false;
    if (isPageMarker(line)) return false;
    if (counts.get(key) >= 3 && line.length < 90) return false;
    return true;
  });

  return rebuildParagraphs(cleanedLines);
}

function normalizeLineKey(line) {
  return line
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^\p{L}\p{N}# ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isCopyrightLine(line) {
  return /copyright|all rights reserved|©|حقوق النشر|جميع الحقوق محفوظة|confidential|proprietary/i.test(line);
}

function isPageMarker(line) {
  return /^(page|slide)\s*\d+(\s*of\s*\d+)?$/i.test(line) || /^(صفحة|شريحة)\s*\d+$/i.test(line) || /^\d+\s*\/\s*\d+$/.test(line);
}

function rebuildParagraphs(lines) {
  const paragraphs = [];
  let current = "";

  lines.forEach((line) => {
    const looksLikeHeading = line.length <= 80 && !/[.!؟?]$/.test(line) && countWords(line) <= 9;
    const endsSentence = /[.!؟?]$/.test(current);

    if (!current) {
      current = line;
    } else if (looksLikeHeading || endsSentence) {
      paragraphs.push(current);
      current = line;
    } else {
      current = `${current} ${line}`;
    }
  });

  if (current) paragraphs.push(current);

  return paragraphs
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function validateLectureText(text) {
  if (!text) {
    if (lastPdfReadFailed) {
      return "لم أتمكن من قراءة ملف PDF. جرّب ملفاً أوضح، أو ألصق نص المحاضرة في مربع النص.";
    }
    return "ارفع ملف PDF أو ألصق نص المحاضرة أولاً، ثم اختر نوع المخرجات.";
  }

  if (countWords(text) < MIN_WORDS) {
    return "النص قصير جداً لتوليد مراجعة مفيدة. أضف محتوى أكثر من المحاضرة ثم جرّب مرة ثانية.";
  }

  return "";
}

function generateResult(type, text) {
  const source = cleanLectureText(text);
  const sentences = splitSentences(source);
  const keywords = extractKeywords(source, 18);
  const concepts = buildConcepts(source, sentences, keywords);

  if (type === "questions") return buildQuestions(sentences, concepts);
  if (type === "flashcards") return buildFlashcards(sentences, concepts);
  if (type === "plan") return buildStudyPlan(sentences, concepts);
  return buildSummary(sentences, concepts);
}

function splitSentences(text) {
  const compactText = text.replace(/\n+/g, " ");
  const sentences = compactText
    .split(/(?<=[.!؟?])\s+|[؛;]\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => countWords(sentence) >= 5);

  if (sentences.length >= 8) return sentences.slice(0, 40);

  const chunks = compactText.match(/.{80,220}(\s|$)/g) || [compactText];
  return chunks.map((chunk) => chunk.trim()).filter((chunk) => countWords(chunk) >= 5).slice(0, 24);
}

function extractKeywords(text, limit = 12) {
  const words = text
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => isUsefulWord(word));

  const counts = new Map();
  words.forEach((word) => {
    const key = word.toLowerCase();
    counts.set(key, { word, count: (counts.get(key)?.count || 0) + 1 });
  });

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || b.word.length - a.word.length)
    .slice(0, limit)
    .map((item) => item.word);
}

function buildConcepts(text, sentences, keywords) {
  const concepts = keywords.map((term) => {
    const sourceSentence =
      sentences.find((sentence) => sentence.toLowerCase().includes(term.toLowerCase())) || sentences[0] || text;

    return {
      term,
      definition: makeSimpleDefinition(term, sourceSentence),
      evidence: sourceSentence,
    };
  });

  if (concepts.length >= 12) return concepts;

  sentences.slice(0, 12).forEach((sentence, index) => {
    concepts.push({
      term: `فكرة ${index + 1}`,
      definition: shorten(sentence, 150),
      evidence: sentence,
    });
  });

  return concepts.slice(0, 18);
}

function buildSummary(sentences, concepts) {
  const shortSummary = sentences.slice(0, 3).map((sentence) => `- ${shorten(sentence, 180)}`).join("\n");
  const importantPoints = sentences.slice(0, 8).map((sentence, index) => `${index + 1}. ${shorten(sentence, 190)}`).join("\n");
  const keyTerms = concepts
    .slice(0, 8)
    .map((concept, index) => `${index + 1}. ${concept.term}: ${concept.definition}`)
    .join("\n");

  return `ملخص قصير:
${shortSummary}

نقاط مهمة:
${importantPoints}

مصطلحات أساسية وتعريفات مبسطة:
${keyTerms}`;
}

function buildQuestions(sentences, concepts) {
  const mcq = Array.from({ length: 5 }, (_, index) => buildMultipleChoiceQuestion(index, concepts, sentences));
  const trueFalse = Array.from({ length: 5 }, (_, index) => buildTrueFalseQuestion(index, concepts, sentences));
  const essays = Array.from({ length: 3 }, (_, index) => buildEssayQuestion(index, concepts, sentences));

  return `أسئلة اختيار من متعدد:
${mcq.join("\n\n")}

أسئلة صح أو خطأ:
${trueFalse.join("\n\n")}

أسئلة مقالية قصيرة:
${essays.join("\n\n")}`;
}

function buildMultipleChoiceQuestion(index, concepts, sentences) {
  const concept = concepts[index % concepts.length];
  const options = uniqueList([
    concept.term,
    concepts[(index + 1) % concepts.length]?.term,
    concepts[(index + 2) % concepts.length]?.term,
    concepts[(index + 3) % concepts.length]?.term,
  ]).slice(0, 4);

  while (options.length < 4) options.push(shorten(sentences[(index + options.length) % sentences.length], 42));

  return `${index + 1}. أي خيار يرتبط أكثر بالعبارة التالية؟
"${shorten(concept.evidence, 150)}"
أ) ${options[0]}
ب) ${options[1]}
ج) ${options[2]}
د) ${options[3]}
الإجابة الصحيحة: أ) ${options[0]}`;
}

function buildTrueFalseQuestion(index, concepts, sentences) {
  const concept = concepts[index % concepts.length];

  if (index % 2 === 0) {
    return `${index + 1}. العبارة: "${shorten(concept.evidence, 170)}"
الإجابة الصحيحة: صح`;
  }

  return `${index + 1}. العبارة: المحاضرة لا تتناول فكرة "${concept.term}".
الإجابة الصحيحة: خطأ`;
}

function buildEssayQuestion(index, concepts, sentences) {
  const concept = concepts[index % concepts.length];
  const related = sentences[(index + 2) % sentences.length] || concept.evidence;

  return `${index + 1}. اشرح باختصار مفهوم "${concept.term}" اعتماداً على المحاضرة.
إجابة مقترحة: ${concept.definition} ويمكن دعم الإجابة بهذه الفكرة: ${shorten(related, 150)}`;
}

function buildFlashcards(sentences, concepts) {
  const cards = [];

  concepts.slice(0, 10).forEach((concept, index) => {
    cards.push(`بطاقة ${index + 1}
الأمام: ما المقصود بـ "${concept.term}"؟
الخلف: ${concept.definition}`);
  });

  let sentenceIndex = 0;
  while (cards.length < 10) {
    const sentence = sentences[sentenceIndex % sentences.length];
    cards.push(`بطاقة ${cards.length + 1}
الأمام: ما الفكرة الرئيسية في العبارة التالية؟ "${shorten(sentence, 120)}"
الخلف: ${shorten(sentence, 170)}`);
    sentenceIndex += 1;
  }

  return cards.join("\n\n");
}

function buildStudyPlan(sentences, concepts) {
  const chunks = chunkArray(sentences, 3);
  const dayTopics = [0, 1, 2].map((index) => {
    const daySentences = chunks[index] || sentences.slice(index * 2, index * 2 + 3);
    const dayConcepts = concepts.slice(index * 4, index * 4 + 4).map((concept) => concept.term).join("، ");

    return {
      study: daySentences.slice(0, 3).map((sentence) => shorten(sentence, 140)).join(" / "),
      review: dayConcepts || concepts.slice(0, 3).map((concept) => concept.term).join("، "),
      test: concepts[index]?.term || "الفكرة الأساسية",
    };
  });

  return `خطة مذاكرة لمدة 3 أيام:

اليوم الأول:
ماذا تذاكر: ${dayTopics[0].study}
ماذا تراجع: ${dayTopics[0].review}
اختبار سريع: اكتب 3 أسئلة قصيرة عن "${dayTopics[0].test}" ثم أجب عنها بدون الرجوع للنص.

اليوم الثاني:
ماذا تذاكر: ${dayTopics[1].study}
ماذا تراجع: ${dayTopics[1].review}
اختبار سريع: اشرح "${dayTopics[1].test}" في 5 أسطر، ثم قارن إجابتك بمحتوى المحاضرة.

اليوم الثالث:
ماذا تذاكر: ${dayTopics[2].study}
ماذا تراجع: ${dayTopics[2].review}
اختبار سريع: حل أسئلة الاختيار والصح والخطأ، ثم راجع البطاقات التي أخطأت فيها.`;
}

function makeSimpleDefinition(term, sentence) {
  const cleaned = shorten(sentence.replace(new RegExp(escapeRegExp(term), "ig"), term), 170);
  return `يرتبط هذا المصطلح بالفكرة التالية في المحاضرة: ${cleaned}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function showResult(title, message, isError = false) {
  currentResult = "";
  resultTitle.textContent = title;
  resultOutput.textContent = message;
  resultOutput.classList.toggle("is-error", isError);
  copyButton.disabled = true;
  downloadButton.disabled = true;
}

function setLoading(isLoading) {
  generateButton.disabled = isLoading;
  generateButton.textContent = isLoading ? "جاري التوليد..." : "ابدأ الآن";
  resultOutput.classList.remove("is-error");
}

function waitForUi() {
  return new Promise((resolve) => window.setTimeout(resolve, 120));
}

function countWords(text) {
  return (text.match(/[\p{L}\p{N}]+/gu) || []).length;
}

function isUsefulWord(word) {
  if (!word || word.length < 4) return false;
  const lower = word.toLowerCase();
  if (arabicStopWords.has(lower) || englishStopWords.has(lower)) return false;
  if (/^\d+$/.test(word)) return false;
  return true;
}

function shorten(text, maxLength) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength).replace(/\s+\S*$/, "")}...`;
}

function uniqueList(items) {
  return [...new Set(items.filter(Boolean))];
}

function chunkArray(items, chunkCount) {
  const size = Math.ceil(items.length / chunkCount);
  return Array.from({ length: chunkCount }, (_, index) => items.slice(index * size, index * size + size));
}
