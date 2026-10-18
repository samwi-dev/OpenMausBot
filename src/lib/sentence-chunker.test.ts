import { describe, expect, it } from "vitest";
import { takeSentences } from "./sentence-chunker";

describe("takeSentences", () => {
  it("splits Chinese on full-width terminators and keeps the partial tail", () => {
    expect(takeSentences("今天天氣很好。我們去公園玩吧！然後")).toEqual({
      sentences: ["今天天氣很好。", "我們去公園玩吧！"],
      rest: "然後",
    });
  });
  it("splits English on '. ' but not inside numbers or at an unconfirmed buffer end", () => {
    expect(takeSentences("Version 3.5 is out. Try it now")).toEqual({
      sentences: ["Version 3.5 is out."],
      rest: "Try it now",
    });
    expect(takeSentences("It works fine.")).toEqual({ sentences: [], rest: "It works fine." });
  });
  it("splits on ? and ! without a trailing space and groups repeats", () => {
    expect(takeSentences("Really?! Yes that is right!")).toEqual({
      sentences: ["Really?!", "Yes that is right!"],
      rest: "",
    });
  });
  it("handles mixed languages and semicolons", () => {
    expect(takeSentences("我用 React 做的；It is fast. 很好用")).toEqual({
      sentences: ["我用 React 做的；", "It is fast."],
      rest: "很好用",
    });
  });
  it("splits on newlines for markdown list lines", () => {
    expect(takeSentences("Here are options:\n- first option\n- second option\npartial")).toEqual({
      sentences: ["Here are options:", "- first option", "- second option"],
      rest: "partial",
    });
  });
  it("merges short pieces into the next one", () => {
    expect(takeSentences("好的。我馬上幫你處理這件事。")).toEqual({
      sentences: ["好的。我馬上幫你處理這件事。"],
      rest: "",
    });
  });
  it("keeps a trailing short piece in rest", () => {
    expect(takeSentences("Hello there friend. Ok.\nxx")).toEqual({
      sentences: ["Hello there friend."],
      rest: "Ok.\nxx",
    });
  });
  it("drops empty and whitespace-only pieces", () => {
    expect(takeSentences("\n\n  \nThis is the answer.\n\n")).toEqual({
      sentences: ["This is the answer."],
      rest: "",
    });
  });
  it("returns everything as rest when nothing is complete", () => {
    expect(takeSentences("still typing")).toEqual({ sentences: [], rest: "still typing" });
    expect(takeSentences("")).toEqual({ sentences: [], rest: "" });
  });
  it("cuts at the first comma when asked, so the opening clause can be voiced early", () => {
    expect(takeSentences("好的，我幫你看一下天氣", { atClause: true })).toEqual({ sentences: ["好的，"], rest: "我幫你看一下天氣" });
    expect(takeSentences("Sure, let me check", { atClause: true })).toEqual({ sentences: ["Sure,"], rest: "let me check" });
    expect(takeSentences("好的，我幫你看一下天氣")).toEqual({ sentences: [], rest: "好的，我幫你看一下天氣" });
  });
});
