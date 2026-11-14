import {createSurveyCompletionHandler} from '../_shared/surveyCompletion.ts';
Deno.serve(createSurveyCompletionHandler(Deno.env.toObject()));
