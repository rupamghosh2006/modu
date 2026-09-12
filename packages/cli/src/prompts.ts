import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import chalk from 'chalk';

export async function promptText(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    const formattedQuestion = defaultValue
      ? `${chalk.cyan('?')} ${chalk.bold(question)} ${chalk.dim(`(${defaultValue})`)}: `
      : `${chalk.cyan('?')} ${chalk.bold(question)}: `;
    const answer = await rl.question(formattedQuestion);
    const trimmed = answer.trim();
    return trimmed || (defaultValue ?? '');
  } finally {
    rl.close();
  }
}

export interface Choice<T extends string> {
  label: string;
  value: T;
  description?: string;
}

export async function promptSelect<T extends string>(
  question: string,
  choices: Choice<T>[],
  defaultIndex = 0
): Promise<T> {
  const rl = readline.createInterface({ input, output });
  try {
    console.log(`\n${chalk.cyan('?')} ${chalk.bold(question)}`);
    choices.forEach((choice, index) => {
      const isDefault = index === defaultIndex;
      const numTag = chalk.bold(`  ${index + 1})`);
      const defaultTag = isDefault ? chalk.dim(' (default)') : '';
      const desc = choice.description ? chalk.dim(` - ${choice.description}`) : '';
      console.log(`${numTag} ${chalk.green(choice.label)}${desc}${defaultTag}`);
    });

    while (true) {
      const defaultVal = choices[defaultIndex]?.value;
      const answer = (
        await rl.question(chalk.dim(`Select [1-${choices.length}] or name (default: ${defaultVal}): `))
      ).trim();

      if (!answer) {
        return defaultVal;
      }

      const num = parseInt(answer, 10);
      if (!isNaN(num) && num >= 1 && num <= choices.length) {
        return choices[num - 1].value;
      }

      const found = choices.find(
        (c) => c.value.toLowerCase() === answer.toLowerCase() || c.label.toLowerCase() === answer.toLowerCase()
      );
      if (found) {
        return found.value;
      }

      console.log(chalk.red(`Invalid choice. Please enter a number between 1 and ${choices.length} or the asset name.`));
    }
  } finally {
    rl.close();
  }
}
