import { MenuItem, Notice, type App } from 'obsidian';
import type { Moment, unitOfTime } from 'moment/moment';
import type { Task } from '../../Task/Task';
import {
    createFixedDateTask,
    createPostponedTask,
    createTaskWithDateRemoved,
    fixedDateMenuItemTitle,
    getDateFieldToPostpone,
    postponeMenuItemTitle,
    postponementSuccessMessage,
    removeDateMenuItemTitle,
} from '../../DateTime/Postponer';
import type { HappensDate } from '../../DateTime/DateFieldTypes';
import { TaskEditingMenu, type TaskSaver, defaultTaskSaver } from './TaskEditingMenu';

type NamingFunction = (task: Task, amount: number, timeUnit: unitOfTime.DurationConstructor) => string;

export type PostponingFunction = (
    task: Task,
    dateFieldToPostpone: HappensDate,
    timeUnit: unitOfTime.DurationConstructor,
    amount: number,
) => {
    postponedDate: moment.Moment | null;
    postponedTask: Task;
};

export class PostponeMenu extends TaskEditingMenu {
    constructor(button: HTMLAnchorElement, task: Task, taskSaver: TaskSaver = defaultTaskSaver) {
        super(taskSaver);

        const postponeMenuItemCallback = (
            button: HTMLAnchorElement,
            item: MenuItem,
            timeUnit: unitOfTime.DurationConstructor,
            amount: number,
            itemNamingFunction: NamingFunction,
            postponingFunction: PostponingFunction,
        ) => {
            // TODO some of the code below is duplicated in postponeOnClickCallback() and may be refactored
            let isCurrentValue = false;
            const dateFieldToPostpone = getDateFieldToPostpone(task);
            if (dateFieldToPostpone) {
                const { postponedDate } = postponingFunction(task, dateFieldToPostpone, timeUnit, amount);

                if (task[dateFieldToPostpone]?.isSame(postponedDate, 'day')) {
                    isCurrentValue = true;
                }
            }

            const title = itemNamingFunction(task, amount, timeUnit);

            item.setChecked(isCurrentValue)
                .setTitle(title)
                .onClick(() =>
                    PostponeMenu.postponeOnClickCallback(button, task, amount, timeUnit, postponingFunction, taskSaver),
                );
        };

        const fixedTitle = fixedDateMenuItemTitle;
        const fixedDateFunction = createFixedDateTask;
        this.addItem((item) => postponeMenuItemCallback(button, item, 'days', 0, fixedTitle, fixedDateFunction));
        this.addItem((item) => postponeMenuItemCallback(button, item, 'day', 1, fixedTitle, fixedDateFunction));

        this.addSeparator();

        const titlingFunction = postponeMenuItemTitle;
        const postponingFunction = createPostponedTask;
        this.addItem((item) => postponeMenuItemCallback(button, item, 'days', 2, titlingFunction, postponingFunction));
        this.addItem((item) => postponeMenuItemCallback(button, item, 'days', 3, titlingFunction, postponingFunction));
        this.addItem((item) => postponeMenuItemCallback(button, item, 'days', 4, titlingFunction, postponingFunction));
        this.addItem((item) => postponeMenuItemCallback(button, item, 'days', 5, titlingFunction, postponingFunction));
        this.addItem((item) => postponeMenuItemCallback(button, item, 'days', 6, titlingFunction, postponingFunction));

        this.addSeparator();

        this.addItem((item) => postponeMenuItemCallback(button, item, 'week', 1, titlingFunction, postponingFunction));
        this.addItem((item) => postponeMenuItemCallback(button, item, 'weeks', 2, titlingFunction, postponingFunction));
        this.addItem((item) => postponeMenuItemCallback(button, item, 'weeks', 3, titlingFunction, postponingFunction));
        this.addItem((item) => postponeMenuItemCallback(button, item, 'month', 1, titlingFunction, postponingFunction));

        this.addSeparator();

        this.addItem((item) =>
            postponeMenuItemCallback(button, item, 'days', 2, removeDateMenuItemTitle, createTaskWithDateRemoved),
        );

        this.addSeparator();

        this.addItem((item) => {
            item.setTitle('Move here')
                .onClick(() => PostponeMenu.moveTaskHereCallback(button, task, taskSaver));
        });
    }

    public static async postponeOnClickCallback(
        button: HTMLAnchorElement,
        task: Task,
        amount: number,
        timeUnit: unitOfTime.DurationConstructor,
        postponingFunction: PostponingFunction = createPostponedTask,
        taskSaver: TaskSaver = defaultTaskSaver,
    ) {
        const dateFieldToPostpone = getDateFieldToPostpone(task);
        if (dateFieldToPostpone === null) {
            const errorMessage = '⚠️ Postponement requires a date: due, scheduled or start.';
            return new Notice(errorMessage, 10000);
        }

        const { postponedDate, postponedTask } = postponingFunction(task, dateFieldToPostpone, timeUnit, amount);

        if (task[dateFieldToPostpone]?.isSame(postponedDate, 'day')) {
            return;
        }

        await taskSaver(task, postponedTask);
        PostponeMenu.postponeSuccessCallback(button, dateFieldToPostpone, postponedDate);
    }

    private static postponeSuccessCallback(
        button: HTMLAnchorElement,
        updatedDateType: HappensDate,
        postponedDate: Moment | null,
    ) {
        // Disable the button to prevent update error due to the task not being reloaded yet.
        button.style.pointerEvents = 'none';

        const successMessage = postponementSuccessMessage(postponedDate, updatedDateType);
        new Notice(successMessage, 2000);
    }

    /**
     * Moves a task from its original location to the current active note.
     * Completes the original task and adds a link to the current note.
     * 
     * @param button - The button that triggered the action
     * @param task - The task to be moved
     * @param taskSaver - Function to save the task changes
     */
    public static async moveTaskHereCallback(
        button: HTMLAnchorElement,
        task: Task,
        taskSaver: TaskSaver = defaultTaskSaver,
    ) {
        // Disable the button to prevent update error due to the task not being reloaded yet
        button.style.pointerEvents = 'none';

        try {
            // Get the app instance and active file
            const app = (window as any).app as App;
            const activeFile = app.workspace.getActiveFile();
            if (!activeFile) {
                new Notice('⚠️ No active file found. Please open a note first.', 5000);
                button.style.pointerEvents = '';
                return;
            }

            // Create a modified version of the original task with a link to the current note
            // Since we can't use 'new Task()' (type-only import), we'll create a modified copy
            const completedTask = Object.assign({}, task, {
                status: app.plugins.getPlugin('obsidian-tasks-plugin')?.statusRegistry?.getStatusBySymbol('x') ?? task.status,
                description: `${task.description} [[${activeFile.basename}]]`
            });

            // Save the completed task in the original location
            await taskSaver(task, completedTask);

            // Get the content of the active file
            const fileContent = await app.vault.read(activeFile);

            // Prepare the task to be added to the current note
            const newTaskContent = task.toFileLineString();

            // Add the task at the end of the file
            const updatedContent = fileContent + '\n' + newTaskContent;

            // Write the updated content back to the file
            await app.vault.modify(activeFile, updatedContent);

            // Show success message
            new Notice(`✅ Task moved to "${activeFile.basename}"`, 2000);
        } catch (error: unknown) {
            console.error('Error moving task:', error);
            new Notice(`⚠️ Error moving task: ${error instanceof Error ? error.message : String(error)}`, 5000);
        } finally {
            // Re-enable the button
            button.style.pointerEvents = '';
        }
    }
}
