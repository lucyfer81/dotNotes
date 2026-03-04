import { markdown } from "@codemirror/lang-markdown";
import CodeMirror from "@uiw/react-codemirror";

type MarkdownEditorProps = {
	value: string;
	onChange: (value: string) => void;
	height?: string;
	className?: string;
};

export default function MarkdownEditor(props: MarkdownEditorProps) {
	const { value, onChange, height = "100%", className } = props;
	return (
		<CodeMirror
			value={value}
			height={height}
			extensions={[markdown()]}
			onChange={onChange}
			className={className}
		/>
	);
}
